import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { join, resolve, sep, extname } from "node:path";

import type { Config } from "./config.ts";
import { makeServices, type Services } from "./workspace.ts";
import { UI_HTML } from "./server-ui.ts";
import { renderDocument, escapeHtml } from "./services/markdown.ts";
import { loadDossierIndex } from "./services/dossier.ts";
import { scoreMatch } from "./services/matcher.ts";
import { withState } from "./services/outreach.ts";
import { filterBoard } from "./services/board-search.ts";

const MAX_BODY_BYTES = 1_000_000;
const RENDERABLE = /\.(md|markdown|txt)$/i;
/** Served as-is with a proper content-type: evidence screenshots and PDFs. */
const BINARY_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".pdf": "application/pdf",
};

/**
 * The local chat/review UI (lavish-axi style): a single-page app served on
 * loopback. The human sends messages and reviews artifacts; the agent polls
 * the same queue through the CLI. Loopback bind + workspace-sandboxed file
 * routes keep personal data on this machine.
 */
export function runServer({ config, port, log = () => {} }: { config: Config; port?: number; log?: (msg: string) => void }): Promise<Server> {
  const services = makeServices(config);
  const server = createServer((req, res) => {
    handle({ req, res, services }).catch((err) => {
      if (!res.headersSent) sendJson(res, 500, { error: (err as Error).message });
      else res.end();
    });
  });
  return new Promise((ok) => {
    server.listen(port ?? config.chatPort, "127.0.0.1", () => {
      const addr = server.address();
      const actual = typeof addr === "object" && addr ? addr.port : port ?? config.chatPort;
      log(`Aja review UI: http://127.0.0.1:${actual}  (ctrl-c to stop)`);
      ok(server);
    });
  });
}

async function handle({ req, res, services }: { req: IncomingMessage; res: ServerResponse; services: Services }): Promise<void> {
  if (!isTrustedHost(req.headers.host)) {
    return sendJson(res, 403, { error: "untrusted host" });
  }
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  const path = url.pathname;
  const method = req.method ?? "GET";

  if (method === "GET" && (path === "/" || path === "/index.html")) {
    return sendHtml(res, 200, UI_HTML);
  }

  if (method === "GET" && path === "/api/state") {
    const [pipeline, prefs, missing, outreach] = await Promise.all([
      services.pipeline.pipeline(),
      services.profile.preferences(),
      services.profile.missingPreferences(),
      services.outreach.list({ all: true }),
    ]);
    return sendJson(res, 200, {
      // the board search box: ?q= filters cards (req id, company, free terms)
      pipeline: filterBoard(pipeline, url.searchParams.get("q")),
      preferences: prefs,
      missingPreferences: missing,
      outreach: outreach.map((m) => withState(m)),
      latestMessageId: await services.chat.latestId(),
      dossierIndexed: await fileExists(services.paths.dossierIndex),
    });
  }

  if (method === "GET" && path === "/api/chat") {
    const since = Number(url.searchParams.get("since") ?? 0) || 0;
    return sendJson(res, 200, await services.chat.list({ since }));
  }

  if (method === "POST" && path === "/api/chat") {
    const body = await readJson(req);
    const record = await services.chat.append({ from: "user", text: String(body.text ?? "") });
    return sendJson(res, 201, record);
  }

  if (method === "POST" && path === "/api/prefs") {
    const body = await readJson(req);
    if (!body.key) return sendJson(res, 400, { error: "key is required" });
    const record = await services.profile.setPreference(String(body.key), body.value as never, { source: "chat" });
    return sendJson(res, 201, record);
  }

  if (method === "POST" && path === "/api/discard") {
    // The candidate's "not interested" button on the board: closes the
    // application (any non-terminal → closed per the status machine; a fresh
    // application can be opened later for the same job).
    const body = await readJson(req);
    const id = String(body.id ?? "");
    if (!id) return sendJson(res, 400, { error: "id is required" });
    const app = await services.pipeline.getApplication(id).catch(() => null);
    if (!app) return sendJson(res, 404, { error: `no application ${id}` });
    const note =
      typeof body.note === "string" && body.note.trim() ? body.note.trim() : "discarded from the web UI";
    const moved = await services.pipeline.move(id, "closed", { note });
    return sendJson(res, 200, { id: moved.id, status: moved.status });
  }

  const appMatch = path.match(/^\/api\/application\/([a-z0-9._-]+)$/i);
  if (method === "GET" && appMatch) {
    const app = await services.pipeline.getApplication(appMatch[1]!);
    const [job, outreach] = await Promise.all([
      services.pipeline.getJob(app.jobId).catch(() => null),
      services.outreach.list({ appId: app.id, all: true }),
    ]);
    return sendJson(res, 200, { ...app, job, outreach: outreach.map((m) => withState(m)) });
  }

  if (method === "GET" && path === "/api/artifact") {
    const rel = url.searchParams.get("path") ?? "";
    return serveArtifact(res, services, rel);
  }

  if (method === "POST" && path === "/api/match") {
    // Re-score an existing job from the UI (uses the dossier index on disk).
    const body = await readJson(req);
    const jobId = String(body.jobId ?? "");
    const job = await services.pipeline.getJob(jobId).catch(() => null);
    if (!job) return sendJson(res, 404, { error: `no job ${jobId}` });
    const index = await loadDossierIndex(services.paths.dossierIndex).catch(() => null);
    if (!index) return sendJson(res, 409, { error: "dossier not indexed yet" });
    const report = scoreMatch(job.description, index);
    await services.pipeline.setJobMatch(jobId, { score: report.score });
    return sendJson(res, 200, { jobId, score: report.score, grade: report.grade, missing: report.missing });
  }

  if (path.startsWith("/api/")) return sendJson(res, 404, { error: "no such api route" });
  return sendHtml(res, 404, "<h1>404</h1>");
}

async function serveArtifact(res: ServerResponse, services: Services, rel: string): Promise<void> {
  const root = resolve(services.paths.root);
  const target = resolve(join(root, rel));
  if (!rel || !target.startsWith(root + sep)) {
    return sendJson(res, 403, { error: "path escapes workspace" });
  }
  let content: Buffer;
  try {
    content = await readFile(target);
  } catch {
    return sendJson(res, 404, { error: `no such artifact: ${rel}` });
  }
  const mime = BINARY_TYPES[extname(target).toLowerCase()];
  if (mime) {
    res.writeHead(200, { "content-type": mime });
    res.end(content);
    return;
  }
  const text = content.toString("utf8");
  if (RENDERABLE.test(extname(target)) || RENDERABLE.test(target)) {
    return sendHtml(res, 200, renderDocument(text, { title: rel }));
  }
  return sendHtml(res, 200, `<pre>${escapeHtml(text)}</pre>`);
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new Error("request body too large");
    chunks.push(chunk as Buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function fileExists(path: string): Promise<boolean> {
  return readFile(path)
    .then(() => true)
    .catch(() => false);
}

/**
 * DNS-rebinding guard: the UI serves a single local candidate, so only
 * loopback hostnames are ever legitimate. A browser-attacker who rebinds
 * their domain to 127.0.0.1 arrives with a foreign Host header and is
 * refused before any route runs.
 */
function isTrustedHost(hostHeader: string | string[] | undefined): boolean {
  const host = String(hostHeader ?? "").toLowerCase().trim();
  if (!host) return false;
  const name = host.replace(/:\d+$/, "");
  return name === "127.0.0.1" || name === "localhost" || name === "[::1]" || name === "::1";
}

function sendJson(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(value));
}

function sendHtml(res: ServerResponse, status: number, html: string): void {
  res.writeHead(status, { "content-type": "text/html; charset=utf-8" });
  res.end(html);
}
