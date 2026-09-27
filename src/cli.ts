import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { parseArgs } from "./args.ts";
import { loadConfig, saveConfig, type Config, type PersistedConfig } from "./config.ts";
import { ensureWorkspace, makeServices, workspacePaths, type Services } from "./workspace.ts";
import { DossierIndexer, loadDossierIndex, searchDossier } from "./services/dossier.ts";
import { scoreMatch, type MatchReport } from "./services/matcher.ts";
import { renderDocument } from "./services/markdown.ts";
import { writeJsonAtomic } from "./fsutil.ts";
import { type PrefValue } from "./services/profile.ts";
import { type Job } from "./domain.ts";

interface Io {
  stdout: { write(s: string): unknown };
  stderr: { write(s: string): unknown };
}

interface CommandContext {
  pos: string[];
  flags: Record<string, string | boolean>;
  io: Io;
  rootDir: string;
}

interface Command {
  name: string;
  summary: string;
  run: (ctx: CommandContext) => Promise<number>;
}

/**
 * The axa toolbelt. Every command maps (positionals, flags, io) -> exit code,
 * so the CLI is fully testable without spawning a process. `bin/axa.ts` is
 * the thin executable shim.
 */
export async function runCommand(argv: string[], { rootDir, stdout, stderr }: { rootDir: string } & Io): Promise<number> {
  const { _, flags } = parseArgs(argv);
  const io: Io = { stdout, stderr };

  if (_.length === 0 || _[0] === "help" || flags.help || flags.h) {
    return printHelp(io);
  }

  // longest-prefix lookup: "job add" beats "job" so subcommands and
  // single-word commands with arguments never collide.
  const twoWord = _.length >= 2 ? `${_[0]} ${_[1]}` : null;
  const command = (twoWord && COMMANDS.find((c) => c.name === twoWord)) || COMMANDS.find((c) => c.name === _[0]);
  if (!command) {
    stderr.write(`error: unknown command "${_.join(" ")}"\n\n`);
    return printHelp(io, 1);
  }

  const rest = command.name.includes(" ") ? _.slice(2) : _.slice(1);
  try {
    return await command.run({ pos: rest, flags, io, rootDir });
  } catch (err) {
    stderr.write(`error: ${(err as Error).message}\n`);
    if (flags.debug) stderr.write((err as Error).stack + "\n");
    return 1;
  }
}

// ---------------------------------------------------------------------------
// shared helpers
// ---------------------------------------------------------------------------

function line(io: Io, text = ""): void {
  io.stdout.write(`${text}\n`);
}

function jsonOut(io: Io, value: unknown): number {
  line(io, JSON.stringify(value, null, 2));
  return 0;
}

function failWith(io: Io, usage: string, message: string): 1 {
  io.stderr.write(`error: ${message}\nusage: axa ${usage}\n`);
  return 1;
}

async function services(rootDir: string): Promise<Services> {
  const config = await loadConfig(rootDir);
  return makeServices(config);
}

function coerceValue(v: string): unknown {
  try {
    return JSON.parse(v);
  } catch {
    return v;
  }
}

// ---------------------------------------------------------------------------
// workspace + config
// ---------------------------------------------------------------------------

async function cmdInit({ io, rootDir }: CommandContext): Promise<number> {
  const config = await saveConfig(rootDir, {});
  const paths = await ensureWorkspace(config);
  line(io, `workspace ready at ${paths.root}`);
  line(io, `next: axa config set --key dossierDir --value ~/path/to/your/dossier`);
  line(io, `then: axa dossier index`);
  return 0;
}

async function cmdConfigGet({ pos, flags, io, rootDir }: CommandContext): Promise<number> {
  const key = flags.key !== undefined ? String(flags.key) : pos[0];
  if (!key) return failWith(io, "config get [key]", "missing config key (omit to print all)");
  const config = await loadConfig(rootDir);
  const value = key === "all" ? { ...config } : (config as unknown as Record<string, unknown>)[key];
  if (value === undefined) return failWith(io, "config get [key]", `unknown config key: ${key}`);
  line(io, typeof value === "string" ? value : JSON.stringify(value, null, 2));
  return 0;
}

async function cmdConfigSet({ pos, flags, io, rootDir }: CommandContext): Promise<number> {
  const key = flags.key !== undefined ? String(flags.key) : pos[0];
  const rawValue = flags.value !== undefined ? flags.value : pos[1];
  if (!key || rawValue === undefined) return failWith(io, "config set <key> <value>", "key and value are required");
  const config = await saveConfig(rootDir, { [key]: coerceValue(String(rawValue)) } as Partial<PersistedConfig>);
  line(io, `${key} = ${JSON.stringify((config as unknown as Record<string, unknown>)[key])}`);
  return 0;
}

// ---------------------------------------------------------------------------
// dossier
// ---------------------------------------------------------------------------

async function cmdDossierIndex({ pos, flags, io, rootDir }: CommandContext): Promise<number> {
  const config = await loadConfig(rootDir);
  const dossierDir = (flags.dir as string) ?? pos[0] ?? config._dossierRoot;
  if (!dossierDir) {
    return failWith(io, "dossier index [--dir path]", "no dossier configured: set config dossierDir or pass --dir");
  }
  const paths = workspacePaths(config);
  const indexer = new DossierIndexer(dossierDir);
  const index = await indexer.index();
  await indexer.save(index, paths.dossierIndex);
  if (flags.json) return jsonOut(io, { root: index.root, stats: index.stats, file: paths.dossierIndex });
  line(io, `indexed ${index.stats.files} files, ${index.stats.words} words -> ${paths.dossierIndex}`);
  return 0;
}

async function cmdDossierSearch({ pos, flags, io, rootDir }: CommandContext): Promise<number> {
  const query = pos.join(" ");
  if (!query) return failWith(io, "dossier search <query words...>", "missing search query");
  const { config } = await services(rootDir);
  const index = await loadDossierIndex(workspacePaths(config).dossierIndex);
  const hits = searchDossier(index, query);
  if (flags.json) return jsonOut(io, hits);
  if (!hits.length) line(io, "no matches");
  for (const h of hits) line(io, `${String(h.score).padStart(6)}  ${h.path}  [${h.kind}]  matched: ${h.matched.join(", ")}`);
  return 0;
}

async function cmdDossierFiles({ flags, io, rootDir }: CommandContext): Promise<number> {
  const { config } = await services(rootDir);
  const index = await loadDossierIndex(workspacePaths(config).dossierIndex);
  let files = index.files;
  if (flags.kind) files = files.filter((f) => f.kind === flags.kind);
  if (flags.json) return jsonOut(io, files);
  for (const f of files) line(io, `[${f.kind}] ${f.path} — ${f.title} (${f.words} words)`);
  line(io, `${files.length} file(s)`);
  return 0;
}

// ---------------------------------------------------------------------------
// jobs + pipeline
// ---------------------------------------------------------------------------

async function cmdJobAdd({ flags, io, rootDir }: CommandContext): Promise<number> {
  const usage = "job add --company <name> --title <title> [--file jd.md | --desc text] [--url url] [--location loc]";
  if (!flags.company || !flags.title) return failWith(io, usage, "--company and --title are required");
  let description = String(flags.desc ?? "");
  if (flags.file) description = await readFile(String(flags.file), "utf8");
  if (!description.trim()) return failWith(io, usage, "a job description is required (--file or --desc)");
  const { pipeline } = await services(rootDir);
  const job = await pipeline.addJob({
    company: String(flags.company),
    title: String(flags.title),
    description,
    url: flags.url ? String(flags.url) : null,
    location: flags.location ? String(flags.location) : null,
  });
  if (flags.json) return jsonOut(io, job);
  line(io, `added ${job.id} — ${job.company} — ${job.title}`);
  return 0;
}

async function cmdJobList({ flags, io, rootDir }: CommandContext): Promise<number> {
  const { pipeline } = await services(rootDir);
  const jobs = await pipeline.listJobs();
  if (flags.json) return jsonOut(io, jobs);
  if (!jobs.length) line(io, "no jobs yet — try: axa job add");
  for (const j of jobs) line(io, `${j.id}  ${j.company} — ${j.title}${j.matchScore !== null ? `  [match ${j.matchScore}]` : ""}`);
  return 0;
}

async function cmdJobShow({ pos, flags, io, rootDir }: CommandContext): Promise<number> {
  const [id] = pos;
  if (!id) return failWith(io, "job show <jobId>", "missing job id");
  const { pipeline } = await services(rootDir);
  const job = await pipeline.getJob(id);
  if (flags.json) return jsonOut(io, job);
  line(io, `${job.id}`);
  line(io, `${job.company} — ${job.title}${job.location ? ` (${job.location})` : ""}`);
  if (job.url) line(io, job.url);
  line(io, `match: ${job.matchScore !== null ? `${job.matchScore}/100` : "not scored"}`);
  line(io);
  line(io, job.description);
  return 0;
}

async function cmdJobMatch({ pos, flags, io, rootDir }: CommandContext): Promise<number> {
  const [id] = pos;
  if (!id) return failWith(io, "job match <jobId>", "missing job id");
  const svc = await services(rootDir);
  const { report, reportPath } = await matchJobAgainstDossier(svc, id);
  if (flags.json) return jsonOut(io, { jobId: id, ...report, reportPath });
  line(io, renderMatchText(report));
  line(io, `report: ${reportPath}`);
  return 0;
}

async function cmdAppStart({ pos, flags, io, rootDir }: CommandContext): Promise<number> {
  const [jobId] = pos;
  if (!jobId) return failWith(io, "app start <jobId> [--resume path] [--force]", "missing job id");
  const { pipeline } = await services(rootDir);
  const app = await pipeline.startApplication(jobId, {
    resumeRef: flags.resume ? String(flags.resume) : null,
    force: Boolean(flags.force),
  });
  if (flags.json) return jsonOut(io, app);
  line(io, `opened ${app.id} for job ${jobId} (status: ${app.status})`);
  return 0;
}

async function cmdAppList({ flags, io, rootDir }: CommandContext): Promise<number> {
  const { pipeline } = await services(rootDir);
  const apps = await pipeline.listApplications({ status: flags.status ? String(flags.status) : undefined });
  if (flags.json) return jsonOut(io, apps);
  if (!apps.length) line(io, "no applications");
  for (const a of apps) {
    line(io, `${a.id}  ${a.status.padEnd(11)} job=${a.jobId}${a.matchScore !== null ? `  match=${a.matchScore}` : ""}`);
  }
  return 0;
}

async function cmdAppShow({ pos, flags, io, rootDir }: CommandContext): Promise<number> {
  const [id] = pos;
  if (!id) return failWith(io, "app show <appId>", "missing application id");
  const svc = await services(rootDir);
  const app = await svc.pipeline.getApplication(id);
  const job = await svc.pipeline.getJob(app.jobId).catch(() => null);
  if (flags.json) return jsonOut(io, { ...app, job });
  line(io, `${app.id}  status=${app.status}  job=${app.jobId}`);
  if (job) line(io, `${job.company} — ${job.title}`);
  line(io, `resume from dossier: ${app.resumeRef ?? "(none chosen)"}`);
  line(io, `match: ${app.matchScore !== null ? `${app.matchScore}/100` : "not scored"}${app.matchReportPath ? ` (${app.matchReportPath})` : ""}`);
  for (const [kind, p] of Object.entries(app.artifacts)) line(io, `artifact ${kind}: ${p ?? "-"}`);
  for (const h of app.history) line(io, `history: ${h.from} -> ${h.to}${h.note ? ` (${h.note})` : ""} at ${h.at}`);
  line(io);
  if (job) line(io, job.description);
  return 0;
}

async function cmdAppMove({ pos, flags, io, rootDir }: CommandContext): Promise<number> {
  const [id, to] = pos;
  if (!id || !to) return failWith(io, "app move <appId> <status> [--note text]", "need <appId> and <status>");
  const { pipeline } = await services(rootDir);
  const app = await pipeline.move(id, to as never, { note: flags.note ? String(flags.note) : null });
  if (flags.json) return jsonOut(io, app);
  line(io, `${app.id}: ${app.history.at(-1)!.from} -> ${app.status}`);
  return 0;
}

async function cmdAppArtifact({ pos, io, rootDir }: CommandContext): Promise<number> {
  const [id, kind, path] = pos;
  if (!id || !kind || !path) {
    return failWith(io, "app artifact <appId> <resume|coverLetter|notes> <workspace-relative-path>", "need <appId>, <kind> and <path>");
  }
  const { pipeline } = await services(rootDir);
  await pipeline.attachArtifact(id, kind as "resume" | "coverLetter" | "notes", path);
  line(io, `attached ${kind} -> ${path}`);
  return 0;
}

async function cmdAppMatch({ pos, flags, io, rootDir }: CommandContext): Promise<number> {
  const [id] = pos;
  if (!id) return failWith(io, "app match <appId>", "missing application id");
  const svc = await services(rootDir);
  const app = await svc.pipeline.getApplication(id);
  const { report, reportPath, reportMarkdownPath } = await matchJobAgainstDossier(svc, app.jobId);
  await svc.pipeline.setMatch(id, { score: report.score, reportPath });
  if (flags.json) return jsonOut(io, { appId: id, ...report, reportPath, reportMarkdown: reportMarkdownPath });
  line(io, renderMatchText(report));
  line(io, `report: ${reportPath} + ${reportMarkdownPath}`);
  return 0;
}

async function cmdPipeline({ flags, io, rootDir }: CommandContext): Promise<number> {
  const { pipeline } = await services(rootDir);
  const board = await pipeline.pipeline();
  if (flags.json) return jsonOut(io, board);
  let total = 0;
  for (const [status, apps] of Object.entries(board)) {
    if (!apps.length) continue;
    line(io, `## ${status}`);
    for (const a of apps) {
      line(io, `  ${a.id}  ${a.company} — ${a.title}${a.matchScore !== null ? `  [match ${a.matchScore}]` : ""}`);
      total++;
    }
  }
  line(io, total ? `${total} application(s)` : "pipeline is empty");
  return 0;
}

/** Score a job description against the dossier index and persist on the job. */
async function matchJobAgainstDossier(svc: Services, jobId: string): Promise<{ report: MatchReport; reportPath: string; reportMarkdownPath: string }> {
  const config = svc.config;
  if (!config._dossierRoot) {
    throw new Error("no dossier configured (config set --key dossierDir --value ~/path)");
  }
  const index = await loadDossierIndex(workspacePaths(config).dossierIndex).catch(() => null);
  if (!index) throw new Error("dossier not indexed yet — run: axa dossier index");

  const job = await svc.pipeline.getJob(jobId);
  const indexer = new DossierIndexer(config._dossierRoot);
  const report = scoreMatch(job.description, index, { indexer });

  const jobsDir = join(workspacePaths(config).root, "jobs");
  const relJson = `jobs/${jobId}/match.json`;
  const relMd = `jobs/${jobId}/match.md`;
  await writeJsonAtomic(join(jobsDir, jobId, "match.json"), { jobId, ...report });
  await writeFile(join(jobsDir, jobId, "match.md"), renderMatchMarkdown(report, job), "utf8");
  await svc.pipeline.setJobMatch(jobId, { score: report.score, reportPath: relJson });
  return { report, reportPath: relJson, reportMarkdownPath: relMd };
}

function renderMatchText(report: MatchReport): string {
  const lines = [`match score: ${report.score}/100 (${report.grade})`];
  if (report.matched.length) lines.push(`covered: ${report.matched.map((m) => m.term).join(", ")}`);
  if (report.missing.length) lines.push(`missing: ${report.missing.join(", ")}`);
  for (const s of report.suggestions ?? []) lines.push(`suggest base resume: ${s.path} (relevance ${s.score})`);
  return lines.join("\n");
}

function renderMatchMarkdown(report: MatchReport, job: Job): string {
  const md = [`# Match report — ${job.company}, ${job.title}`, "", `**Score:** ${report.score}/100 (${report.grade})`, ""];
  md.push("## Covered terms", "");
  md.push(...(report.matched.length ? report.matched.map((m) => `- ${m.term} (x${m.count} in JD)`) : ["- (none)"]));
  md.push("", "## Missing terms", "");
  md.push(...(report.missing.length ? report.missing.map((t) => `- ${t}`) : ["- (none)"]));
  if (report.suggestions?.length) {
    md.push("", "## Suggested base resumes", "");
    md.push(...report.suggestions.map((s) => `- ${s.path} (${s.kind}, relevance ${s.score})`));
  }
  return md.join("\n");
}

// ---------------------------------------------------------------------------
// preferences + answers (ask-and-remember stores)
// ---------------------------------------------------------------------------

async function cmdPrefsList({ flags, io, rootDir }: CommandContext): Promise<number> {
  const { profile } = await services(rootDir);
  const prefs = await profile.preferences();
  if (flags.json) return jsonOut(io, prefs);
  if (!prefs.length) line(io, "(no preferences stored yet)");
  for (const p of prefs) line(io, `${p.key} = ${JSON.stringify(p.value)}  [${p.source}, ${p.updatedAt}]`);
  return 0;
}

async function cmdPrefsSet({ pos, flags, io, rootDir }: CommandContext): Promise<number> {
  const key = flags.key !== undefined ? String(flags.key) : pos[0];
  const rawValue = flags.value !== undefined ? flags.value : pos[1];
  if (!key || rawValue === undefined) return failWith(io, "prefs set <key> <value> [--source chat|user|inferred] [--note n]", "key and value are required");
  const { profile } = await services(rootDir);
  const source = (flags.source === "chat" || flags.source === "inferred" ? flags.source : "user") as "chat" | "inferred" | "user";
  const record = await profile.setPreference(key, coerceValue(String(rawValue)) as PrefValue, {
    source,
    note: flags.note ? String(flags.note) : undefined,
  });
  if (flags.json) return jsonOut(io, record);
  line(io, `${record.key} = ${JSON.stringify(record.value)}`);
  return 0;
}

async function cmdPrefsGet({ pos, flags, io, rootDir }: CommandContext): Promise<number> {
  const key = flags.key !== undefined ? String(flags.key) : pos[0];
  if (!key) return failWith(io, "prefs get <key>", "missing preference key");
  const { profile } = await services(rootDir);
  const record = await profile.getPreference(key);
  if (flags.json) return jsonOut(io, record);
  line(io, record ? JSON.stringify(record.value) : "(not set)");
  return record ? 0 : 1;
}

async function cmdPrefsMissing({ flags, io, rootDir }: CommandContext): Promise<number> {
  const { profile } = await services(rootDir);
  const missing = await profile.missingPreferences();
  if (flags.json) return jsonOut(io, missing);
  line(io, missing.length ? `ask the captain about: ${missing.join(", ")}` : "(all recommended preferences are set)");
  return 0;
}

async function cmdAnswersSet({ pos, flags, io, rootDir }: CommandContext): Promise<number> {
  const question = flags.question ? String(flags.question) : pos[0];
  const answer = flags.answer !== undefined ? String(flags.answer) : pos[1];
  if (!question || answer === undefined) return failWith(io, "answers set <question> <answer>", "question and answer are required");
  const { profile } = await services(rootDir);
  const record = await profile.recordAnswer(question, answer);
  if (flags.json) return jsonOut(io, record);
  line(io, `remembered: "${record.question}" -> "${record.answer}"`);
  return 0;
}

async function cmdAnswersGet({ pos, flags, io, rootDir }: CommandContext): Promise<number> {
  const question = pos.join(" ") || String(flags.question ?? "");
  if (!question.trim()) return failWith(io, "answers get <question...>", "missing question");
  const { profile } = await services(rootDir);
  const record = await profile.findAnswer(question);
  if (flags.json) return jsonOut(io, record);
  if (!record) {
    line(io, "(no stored answer — ask the captain, then: axa answers set)");
    return 1;
  }
  line(io, record.answer);
  return 0;
}

async function cmdAnswersList({ flags, io, rootDir }: CommandContext): Promise<number> {
  const { profile } = await services(rootDir);
  const records = await profile.answers();
  if (flags.json) return jsonOut(io, records);
  if (!records.length) line(io, "(no answers stored yet)");
  for (const r of records) line(io, `Q: ${r.question}\n   A: ${r.answer}`);
  return 0;
}

// ---------------------------------------------------------------------------
// chat
// ---------------------------------------------------------------------------

async function chatAppend(ctx: CommandContext, from: "user" | "agent"): Promise<number> {
  const { pos, flags, io, rootDir } = ctx;
  const text = pos.join(" ");
  if (!text.trim()) {
    return failWith(io, `chat ${from} <message...>`, "missing message text");
  }
  const { chat } = await services(rootDir);
  const msg = await chat.append({ from, text, meta: flags.meta ? (coerceValue(String(flags.meta)) as unknown) : null });
  if (flags.json) return jsonOut(io, msg);
  line(io, `#${msg.id} ${from}: ${msg.text}`);
  return 0;
}

async function cmdChatSend(ctx: CommandContext): Promise<number> {
  return chatAppend(ctx, "user");
}

async function cmdChatReply(ctx: CommandContext): Promise<number> {
  return chatAppend(ctx, "agent");
}

async function cmdChatPoll({ flags, io, rootDir }: CommandContext): Promise<number> {
  const { chat } = await services(rootDir);
  const waitMs = Math.min(Math.max(0, Math.round(Number(flags.wait ?? 0) * 1000)), 110_000);
  const since = Number(flags.since ?? 0) || 0;
  const msgs = await chat.poll({ since, waitMs });
  if (flags.json) return jsonOut(io, msgs);
  if (!msgs.length) line(io, "(no new messages)");
  for (const m of msgs) line(io, `#${m.id} ${m.text}${m.meta ? `  [meta: ${JSON.stringify(m.meta)}]` : ""}`);
  return 0;
}

async function cmdChatLog({ flags, io, rootDir }: CommandContext): Promise<number> {
  const { chat } = await services(rootDir);
  const msgs = await chat.list({ since: Number(flags.since ?? 0) || 0 });
  if (flags.json) return jsonOut(io, msgs);
  for (const m of msgs) line(io, `#${m.id} ${m.at} ${m.from}: ${m.text}`);
  return 0;
}

async function cmdChatServe({ flags, io, rootDir }: CommandContext): Promise<number> {
  const { runServer } = await import("./server.ts");
  const config = await loadConfig(rootDir);
  await ensureWorkspace(config);
  const port = Number(flags.port ?? config.chatPort);
  runServer({ config, port, log: (msg) => line(io, msg) });
  return new Promise<number>(() => {}); // serve until interrupted
}

// ---------------------------------------------------------------------------
// artifacts + help
// ---------------------------------------------------------------------------

async function cmdRender({ pos, flags, io }: CommandContext): Promise<number> {
  const [input] = pos;
  if (!input) return failWith(io, "render <file.md> [--out file.html]", "missing markdown file");
  const md = await readFile(input, "utf8");
  const outPath = flags.out ? String(flags.out) : input.replace(/\.md$/i, ".html");
  const title = flags.title ? String(flags.title) : input.split("/").pop()!;
  await writeFile(outPath, renderDocument(md, { title }), "utf8");
  line(io, `rendered ${outPath}`);
  return 0;
}

function printHelp(io: Io, code = 0): number {
  const target = code === 0 ? io.stdout : io.stderr;
  target.write(
    [
      "usage: axa <command> [args] [--json] [--debug]",
      "",
      "workspace:",
      "  init                            scaffold config + workspace",
      "  config get [key] | set <k> <v>  read/update settings",
      "",
      "dossier:",
      "  dossier index [--dir path]        index the resume dossier",
      "  dossier search <query...>         find dossier files by keywords",
      "  dossier files [--kind kind]       list indexed files",
      "",
      "preferences (your decisions — never hardcoded):",
      "  prefs list | prefs get <key> | prefs set <key> <value>",
      "  prefs missing                     what the agent should ask about",
      "",
      "answers (form-question memory for browser autofill):",
      "  answers set <question> <answer>   remember a Q/A pair",
      "  answers get <question...>         recall the best matching answer",
      "  answers list                      dump all stored answers",
      "",
      "pipeline:",
      "  job add --company C --title T [--file jd.md | --desc text]",
      "  job list | job show <id>",
      "  job match <jobId>               score JD vs dossier (relevance gate)",
      "  app start <jobId> [--resume p] [--force]",
      "  app list [--status s] | app show <id>",
      "  app move <id> <status> [--note n]",
      "  app artifact <id> <kind> <path>",
      "  app match <appId>               score + attach report to application",
      "  pipeline                        kanban view of all applications",
      "",
      "chat (the human <-> agent loop):",
      "  chat send <text...>             human sends a message",
      "  chat reply <text...>            agent posts a reply",
      "  chat poll [--since n] [--wait s]  fetch new user messages",
      "  chat log [--since n]            full transcript",
      "  chat serve [--port p]           open the local chat/review UI",
      "",
      "artifacts:",
      "  render <file.md> [--out f.html]   markdown -> reviewable html",
      "",
    ].join("\n"),
  );
  return code;
}

const COMMANDS: Command[] = [
  { name: "init", summary: "scaffold workspace", run: cmdInit },
  { name: "config get", summary: "read settings", run: cmdConfigGet },
  { name: "config set", summary: "update settings", run: cmdConfigSet },
  { name: "dossier index", summary: "index dossier", run: cmdDossierIndex },
  { name: "dossier search", summary: "search dossier", run: cmdDossierSearch },
  { name: "dossier files", summary: "list dossier files", run: cmdDossierFiles },
  { name: "prefs list", summary: "list preferences", run: cmdPrefsList },
  { name: "prefs set", summary: "store a preference", run: cmdPrefsSet },
  { name: "prefs get", summary: "read a preference", run: cmdPrefsGet },
  { name: "prefs missing", summary: "unset recommended preferences", run: cmdPrefsMissing },
  { name: "answers set", summary: "remember a form answer", run: cmdAnswersSet },
  { name: "answers get", summary: "recall a form answer", run: cmdAnswersGet },
  { name: "answers list", summary: "list stored answers", run: cmdAnswersList },
  { name: "job add", summary: "add a job posting", run: cmdJobAdd },
  { name: "job list", summary: "list jobs", run: cmdJobList },
  { name: "job show", summary: "show a job", run: cmdJobShow },
  { name: "job match", summary: "score job vs dossier", run: cmdJobMatch },
  { name: "app start", summary: "open an application", run: cmdAppStart },
  { name: "app list", summary: "list applications", run: cmdAppList },
  { name: "app show", summary: "show an application", run: cmdAppShow },
  { name: "app move", summary: "move status", run: cmdAppMove },
  { name: "app artifact", summary: "attach artifact", run: cmdAppArtifact },
  { name: "app match", summary: "score + attach report", run: cmdAppMatch },
  { name: "pipeline", summary: "kanban view", run: cmdPipeline },
  { name: "chat send", summary: "user message", run: cmdChatSend },
  { name: "chat reply", summary: "agent message", run: cmdChatReply },
  { name: "chat poll", summary: "fetch user messages", run: cmdChatPoll },
  { name: "chat log", summary: "transcript", run: cmdChatLog },
  { name: "chat serve", summary: "chat/review UI", run: cmdChatServe },
  { name: "render", summary: "markdown to html", run: cmdRender },
];
