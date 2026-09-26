import { Application, Job, STATUSES, TERMINAL_STATUSES } from "../domain.js";

const ARTIFACT_KINDS = new Set(["resume", "coverLetter", "notes"]);

/**
 * Service: orchestration for the job-application pipeline. Owns the business
 * rules that span entities (duplicate-open guard, readiness gate); storage
 * ports are injected, so this class stays persistence-agnostic (DIP).
 */
export class PipelineService {
  /**
   * @param {object} ports
   * @param {import("../adapters/json-collection.js").Collection} ports.jobs
   * @param {import("../adapters/json-collection.js").Collection} ports.applications
   */
  constructor({ jobs, applications }) {
    this.jobs = jobs;
    this.applications = applications;
  }

  // -- Jobs -----------------------------------------------------------------

  async addJob(input, { now = new Date().toISOString() } = {}) {
    const job = Job.create(input, { now });
    return this.jobs.put(job);
  }

  getJob(id) {
    return this.jobs.get(id);
  }

  listJobs() {
    return this.jobs.list();
  }

  // -- Applications -----------------------------------------------------------

  /** Open an application for a job; one open application per job at a time. */
  async startApplication(jobId, { resumeRef = null, now = new Date().toISOString() } = {}) {
    await this.jobs.get(jobId); // rejects NOT_FOUND
    const existing = await this.applications.list();
    const open = existing.find(
      (a) => a.jobId === jobId && !TERMINAL_STATUSES.includes(a.status)
    );
    if (open) {
      throw new Error(`job ${jobId} already has an open application (${open.id}, ${open.status})`);
    }
    const app = Application.create({ jobId, resumeRef }, { now });
    return this.applications.put(app);
  }

  getApplication(id) {
    return this.applications.get(id);
  }

  async listApplications({ status } = {}) {
    const all = await this.applications.list();
    return status ? all.filter((a) => a.status === status) : all;
  }

  /** Move an application through the status machine (with readiness gates). */
  async move(id, to, { note = null, now = new Date().toISOString() } = {}) {
    const app = await this.applications.get(id);
    if (to === "ready" && !app.artifacts.resume) {
      throw new Error(`application ${id} cannot become ready: no tailored resume artifact yet`);
    }
    const moved = Application.recordTransition(app, to, { at: now, note });
    return this.applications.put(moved);
  }

  /** Record a match report (score + workspace-relative report path). */
  async setMatch(id, { score, reportPath = null }) {
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

  async setResumeRef(id, resumeRef) {
    const app = await this.applications.get(id);
    return this.applications.put({
      ...app,
      resumeRef: resumeRef || null,
      updatedAt: new Date().toISOString(),
    });
  }

  /** Attach a workspace-relative artifact path (resume | coverLetter | notes). */
  async attachArtifact(id, kind, relPath) {
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
  async pipeline() {
    const [jobs, apps] = await Promise.all([this.jobs.list(), this.applications.list()]);
    const jobById = new Map(jobs.map((j) => [j.id, j]));
    const board = Object.fromEntries(STATUSES.map((s) => [s, []]));
    for (const app of apps) {
      const job = jobById.get(app.jobId);
      board[app.status].push({
        id: app.id,
        jobId: app.jobId,
        company: job?.company ?? "(missing job)",
        title: job?.title ?? "(missing job)",
        status: app.status,
        matchScore: app.matchScore,
        resumeRef: app.resumeRef,
        updatedAt: app.updatedAt,
      });
    }
    for (const status of Object.keys(board)) {
      board[status].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    }
    return board;
  }
}
