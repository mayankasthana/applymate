import { copyFile, mkdir, stat } from "node:fs/promises";
import { join, extname } from "node:path";

import type { Evidence, Evidence as EvidenceEntry, Job, Application } from "../domain.ts";
import { makeId, shortCode } from "../ids.ts";
import type { Collection } from "../adapters/json-collection.ts";

/** File types we accept as captures — screenshots, page snapshots, documents. */
const ALLOWED_EXTENSIONS: ReadonlySet<string> = new Set([
  ".png", ".jpg", ".jpeg", ".webp", ".gif", ".pdf", ".html", ".htm", ".txt", ".md",
]);

export interface CaptureOptions {
  kind: string;
  note?: string | null;
  url?: string | null;
  at?: string;
}

/**
 * Service: the evidence trail. Copies a capture (screenshot, snapshot,
 * confirmation) into the workspace next to its record and appends a structured
 * entry (kind, ISO timestamp, source url, note) to the Job or Application:
 *
 *   workspace/jobs/<jobId>/evidence/<stamp>-<kind>-<id>.<ext>
 *   workspace/applications/<appId>/evidence/<stamp>-<kind>-<id>.<ext>
 *
 * Evidence proves what the posting said before applying and what the portal
 * showed after submitting.
 */
export class EvidenceStore {
  readonly #jobs: Collection<Job>;
  readonly #applications: Collection<Application>;
  readonly #workspaceRoot: string;
  readonly #now: () => string;

  constructor({
    jobs,
    applications,
    workspaceRoot,
    now = () => new Date().toISOString(),
  }: {
    jobs: Collection<Job>;
    applications: Collection<Application>;
    workspaceRoot: string;
    now?: () => string;
  }) {
    this.#jobs = jobs;
    this.#applications = applications;
    this.#workspaceRoot = workspaceRoot;
    this.#now = now;
  }

  async captureJob(jobId: string, sourceFile: string, opts: CaptureOptions): Promise<EvidenceEntry> {
    const job = await this.#jobs.get(jobId).catch(() => {
      throw new Error(`no job with id ${jobId}`);
    });
    const entry = await this.#capture(join("jobs", jobId), sourceFile, opts);
    await this.#jobs.put({ ...job, evidence: [...(job.evidence ?? []), entry] });
    return entry;
  }

  async captureApplication(appId: string, sourceFile: string, opts: CaptureOptions): Promise<EvidenceEntry> {
    const app = await this.#applications.get(appId).catch(() => {
      throw new Error(`no application with id ${appId}`);
    });
    const entry = await this.#capture(join("applications", appId), sourceFile, opts);
    await this.#applications.put({ ...app, evidence: [...(app.evidence ?? []), entry] });
    return entry;
  }

  async #capture(targetDir: string, sourceFile: string, opts: CaptureOptions): Promise<Evidence> {
    const kind = validateKind(opts.kind);
    const at = opts.at ?? this.#now();

    let info;
    try {
      info = await stat(sourceFile);
    } catch {
      throw new Error(`evidence source file not found: ${sourceFile}`);
    }
    if (!info.isFile()) throw new Error(`evidence source is not a file: ${sourceFile}`);

    const ext = extname(sourceFile).toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      throw new Error(`unsupported evidence file type "${ext}" (allowed: ${[...ALLOWED_EXTENSIONS].join(" ")})`);
    }

    const fileName = `${stamp(at)}-${kind}-${shortCode()}${ext}`;
    const destAbs = join(this.#workspaceRoot, targetDir, "evidence", fileName);
    await mkdir(join(this.#workspaceRoot, targetDir, "evidence"), { recursive: true });
    await copyFile(sourceFile, destAbs);

    return {
      id: makeId("ev"),
      kind,
      path: `${targetDir.split("\\").join("/")}/evidence/${fileName}`,
      at,
      url: opts.url ?? null,
      note: opts.note ?? null,
    };
  }
}

function validateKind(kind: unknown): string {
  const k = String(kind ?? "").toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]*$/.test(k)) {
    throw new Error(`evidence kind must be a slug like "jd-screenshot" or "submit-screenshot", got: ${String(kind)}`);
  }
  return k;
}

/** "2026-09-27T10:00:00.000Z" -> "20260927T100000" for filename sorting. */
function stamp(at: string): string {
  const iso = new Date(at).toISOString();
  return iso.slice(0, 19).replace(/[-:]/g, "");
}
