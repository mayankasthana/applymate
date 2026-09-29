import {
  Application,
  Job,
  type Application as ApplicationRecord,
  type Job as JobRecord,
  type JobInput,
  type Pursuit,
  type PursuitVerdict,
  type Status,
  STATUSES,
  TERMINAL_STATUSES,
} from "../domain.ts";
import type { Collection } from "../adapters/json-collection.ts";

export class RelevanceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RelevanceError";
  }
}

const ARTIFACT_KINDS: ReadonlySet<string> = new Set(["resume", "coverLetter", "notes"]);

export interface AppSummary {
  id: string;
  jobId: string;
  company: string;
  title: string;
  status: Status;
  matchScore: number | null;
  pursuit: Pursuit | null;
  resumeRef: string | null;
  updatedAt: string;
  jobUrl: string | null;
}

/**
 * Service: orchestration for the job-application pipeline. Owns the business
 * rules that span entities (relevance gate, duplicate-open guard, readiness
 * gate); storage ports are injected, so this class stays persistence-agnostic (DIP).
 */
export class PipelineService {
  readonly jobs: Collection<JobRecord>;
  readonly applications: Collection<ApplicationRecord>;
  readonly #minMatchScore: number;

  constructor({
    jobs,
    applications,
    minMatchScore = 0,
  }: {
    jobs: Collection<JobRecord>;
    applications: Collection<ApplicationRecord>;
    /** Applications for jobs scoring below this are refused unless forced. */
    minMatchScore?: number;
  }) {
    this.jobs = jobs;
    this.applications = applications;
    this.#minMatchScore = minMatchScore;
  }

  get minMatchScore(): number {
    return this.#minMatchScore;
  }

  // -- Jobs -----------------------------------------------------------------

  async addJob(input: JobInput, { now = new Date().toISOString() } = {}): Promise<JobRecord> {
    const job = Job.create(input, { now });
    return this.jobs.put(job);
  }

  getJob(id: string): Promise<JobRecord> {
    return this.jobs.get(id);
  }

  listJobs(): Promise<JobRecord[]> {
    return this.jobs.list();
  }

  /** Persist a dossier-match result on the job (drives the relevance gate). */
  async setJobMatch(jobId: string, { score, reportPath = null, at = new Date().toISOString() }: { score: number; reportPath?: string | null; at?: string }): Promise<JobRecord> {
    if (!Number.isFinite(score)) throw new Error(`match score must be a number, got: ${score}`);
    const job = await this.jobs.get(jobId);
    return this.jobs.put({ ...job, matchScore: Math.round(score), matchReportPath: reportPath, matchedAt: at });
  }

  // -- Applications -----------------------------------------------------------

  /**
   * Open an application for a job; one open application per job at a time.
   * Relevance gate: refuses when the job's last match score is below the
   * configured minimum, unless force=true. Unscored jobs pass (the agent is
   * expected to score first — the UI/AGENTS flow enforces that socially).
   */
  async startApplication(
    jobId: string,
    { resumeRef = null, force = false, now = new Date().toISOString() }: { resumeRef?: string | null; force?: boolean; now?: string } = {}
  ): Promise<ApplicationRecord> {
    const job = await this.jobs.get(jobId); // rejects NOT_FOUND
    if (!force && job.matchScore !== null && job.matchScore < this.#minMatchScore) {
      throw new RelevanceError(
        `job ${jobId} scored ${job.matchScore}/100, below your relevance floor of ${this.#minMatchScore} ` +
          `(config minMatchScore). Force with --force if you really want this one.`
      );
    }
    const existing = await this.applications.list();
    const open = existing.find((a) => a.jobId === jobId && !TERMINAL_STATUSES.includes(a.status));
    if (open) {
      throw new Error(`job ${jobId} already has an open application (${open!.id}, ${open!.status})`);
    }
    const app = Application.create({ jobId, resumeRef }, { now });
    return this.applications.put(app);
  }

  getApplication(id: string): Promise<ApplicationRecord> {
    return this.applications.get(id);
  }

  async listApplications({ status }: { status?: string } = {}): Promise<ApplicationRecord[]> {
    const all = await this.applications.list();
    return status ? all.filter((a) => a.status === status) : all;
  }

  /** Move an application through the status machine (with readiness gates). */
  async move(id: string, to: Status, { note = null, at = new Date().toISOString() }: { note?: string | null; at?: string } = {}): Promise<ApplicationRecord> {
    const app = await this.applications.get(id);
    if (to === "ready" && !app.artifacts.resume) {
      throw new Error(`application ${id} cannot become ready: no tailored resume artifact yet`);
    }
    const moved = Application.recordTransition(app, to, { at, note });
    return this.applications.put(moved);
  }

  /** Record a match report (score + workspace-relative report path). */
  async setMatch(id: string, { score, reportPath = null }: { score: number; reportPath?: string | null }): Promise<ApplicationRecord> {
    const app = await this.applications.get(id);
    if (!Number.isFinite(score)) {
      throw new Error(`match score must be a number, got: ${score}`);
    }
    return this.applications.put({
      ...app,
      matchScore: Math.round(score),
      matchReportPath: reportPath,
      updatedAt: new Date().toISOString(),
    });
  }

  /**
   * Record the agent's conversion-odds verdict (the second score next to the
   * match score: college/brand/ML gates). Overwrites any previous verdict.
   */
  async setPursuit(id: string, verdict: PursuitVerdict, { note = null, at = new Date().toISOString() }: { note?: string | null; at?: string } = {}): Promise<ApplicationRecord> {
    const app = await this.applications.get(id);
    return this.applications.put(Application.recordPursuit(app, verdict, { note, at }));
  }

  async setResumeRef(id: string, resumeRef: string | null): Promise<ApplicationRecord> {
    const app = await this.applications.get(id);
    return this.applications.put({
      ...app,
      resumeRef: resumeRef || null,
      updatedAt: new Date().toISOString(),
    });
  }

  /**
   * Record the submission: exact time, portal, confirmation number. Walks the
   * status machine to `submitted` (refuses illegal jumps); if the application
   * is already submitted, only updates the details.
   */
  async markSubmitted(
    id: string,
    { at = new Date().toISOString(), portal = null, confirmation = null, note = null }: {
      at?: string;
      portal?: string | null;
      confirmation?: string | null;
      note?: string | null;
    }
  ): Promise<ApplicationRecord> {
    const app = await this.applications.get(id);
    let moved = app;
    if (app.status !== "submitted") {
      moved = Application.recordTransition(app, "submitted", { at, note });
    }
    return this.applications.put({
      ...moved,
      submittedAt: at,
      submissionPortal: portal ?? moved.submissionPortal,
      submissionConfirmation: confirmation ?? moved.submissionConfirmation,
    });
  }

  /** Attach a workspace-relative artifact path (resume | coverLetter | notes). */
async attachArtifact(id: string, kind: "resume" | "coverLetter" | "notes", relPath: string): Promise<ApplicationRecord> {
  if (!ARTIFACT_KINDS.has(kind)) {
    throw new Error(`unknown artifact kind: ${kind} (known: ${[...ARTIFACT_KINDS].join(", ")})`);
  }
  const app = await this.applications.get(id);
    return this.applications.put({
      ...app,
      artifacts: { ...app.artifacts, [kind]: relPath },
      updatedAt: new Date().toISOString(),
    });
  }

  /** Kanban view: every status -> application summaries with job details. */
  async pipeline(): Promise<Record<Status, AppSummary[]>> {
    const [jobs, apps] = await Promise.all([this.jobs.list(), this.applications.list()]);
    const jobById = new Map(jobs.map((j) => [j.id, j]));
    const board = Object.fromEntries(STATUSES.map((s) => [s, [] as AppSummary[]])) as Record<Status, AppSummary[]>;
    for (const app of apps) {
      const job = jobById.get(app.jobId);
      board[app.status].push({
        id: app.id,
        jobId: app.jobId,
        company: job?.company ?? "(missing job)",
        title: job?.title ?? "(missing job)",
        status: app.status,
        matchScore: app.matchScore ?? job?.matchScore ?? null,
        pursuit: app.pursuit ?? null,
        resumeRef: app.resumeRef,
        updatedAt: app.updatedAt,
        jobUrl: job?.url ?? null,
      });
    }
    for (const status of Object.keys(board) as Status[]) {
      board[status].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    }
    return board;
  }
}
