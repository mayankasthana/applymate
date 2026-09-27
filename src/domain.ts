/**
 * Domain entities and rules. Pure data + pure functions: no I/O here.
 * Persistence, orchestration and presentation live in services/adapters.
 */

import { makeId } from "./ids.ts";

export class DomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DomainError";
  }
}

// ---------------------------------------------------------------------------
// Job
// ---------------------------------------------------------------------------

export interface Job {
  id: string;
  company: string;
  title: string;
  description: string;
  location: string | null;
  url: string | null;
  addedAt: string;
  /** Last dossier-match score (null = never scored). Drives the relevance gate. */
  matchScore: number | null;
  matchReportPath: string | null;
  matchedAt: string | null;
  /** Captures proving what the posting said (screenshots, page snapshots). */
  evidence: Evidence[];
}

/** A stored capture (screenshot, snapshot, confirmation) tied to a record.
 *  `path` is workspace-relative; `at` is when the capture was taken/stored. */
export interface Evidence {
  id: string;
  /** Convention: jd-screenshot, jd-snapshot, submit-screenshot, confirmation, other-<x> */
  kind: string;
  path: string;
  at: string;
  url?: string | null;
  note?: string | null;
}

export interface JobInput {
  id?: string;
  company?: unknown;
  title?: unknown;
  description?: unknown;
  location?: unknown;
  url?: unknown;
  addedAt?: string;
}

export class Job {
  /** Create a validated job, generating an id when absent. */
  static create(input: JobInput, { now = new Date().toISOString() } = {}): Job {
    const job: Job = {
      id: input.id ?? makeId("job", `${str(input.company)} ${str(input.title)}`),
      company: str(input.company),
      title: str(input.title),
      description: str(input.description),
      location: strOr(input.location, null),
      url: strOr(input.url, null),
      addedAt: input.addedAt ?? now,
      matchScore: null,
      matchReportPath: null,
      matchedAt: null,
      evidence: [],
    };
    Job.validate(job, { requireId: false });
    if (job.url !== null && !/^https?:\/\/\S+$/.test(job.url)) {
      throw new DomainError(`job url must be an http(s) url, got: ${job.url}`);
    }
    return job;
  }

  /** Validate a loaded record (id included), normalizing optional fields. */
  static validate(job: Job, { requireId = true } = {}): Job {
    const missing = (["company", "title", "description"] as const).filter((k) => !str(job[k]));
    if (missing.length) {
      throw new DomainError(`job is missing required fields: ${missing.join(", ")}`);
    }
    if (requireId && !str(job.id)) throw new DomainError("job is missing required field: id");
    if (!str(job.addedAt)) throw new DomainError("job is missing required field: addedAt");
    job.matchScore = typeof job.matchScore === "number" ? job.matchScore : null;
    job.matchReportPath = strOr(job.matchReportPath, null);
    job.matchedAt = strOr(job.matchedAt, null);
    job.evidence = Array.isArray(job.evidence) ? job.evidence : [];
    return job;
  }
}

// ---------------------------------------------------------------------------
// Application status machine
// ---------------------------------------------------------------------------

export const STATUSES = [
  "discovered",
  "matched",
  "tailoring",
  "ready",
  "submitted",
  "interviewing",
  "offer",
  "rejected",
  "closed",
] as const;

export type Status = (typeof STATUSES)[number];

export const TERMINAL_STATUSES: readonly Status[] = ["rejected", "closed"];

const TRANSITIONS: Record<Status, readonly Status[]> = {
  discovered: ["matched", "closed"],
  matched: ["tailoring", "closed"],
  tailoring: ["ready", "closed"],
  ready: ["submitted", "closed"],
  submitted: ["interviewing", "rejected", "closed"],
  interviewing: ["offer", "rejected", "closed"],
  offer: ["closed"],
  rejected: [],
  closed: [],
};

export function isStatus(value: string): value is Status {
  return (STATUSES as readonly string[]).includes(value);
}

export function canTransition(from: Status, to: Status): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(from: Status, to: Status): true {
  if (!canTransition(from, to)) {
    throw new DomainError(
      `illegal status transition ${from} -> ${to} (allowed: ${TRANSITIONS[from].join(", ") || "none"})`
    );
  }
  return true;
}

// ---------------------------------------------------------------------------
// Application
// ---------------------------------------------------------------------------

export interface ApplicationArtifacts {
  resume: string | null;
  coverLetter: string | null;
  notes: string | null;
}

export interface HistoryEntry {
  at: string;
  from: Status;
  to: Status;
  note: string | null;
}

export interface Application {
  id: string;
  jobId: string;
  status: Status;
  resumeRef: string | null;
  matchScore: number | null;
  matchReportPath: string | null;
  artifacts: ApplicationArtifacts;
  history: HistoryEntry[];
  /** Exactly when the application was submitted (set via `app submitted`). */
  submittedAt: string | null;
  submissionPortal: string | null;
  submissionConfirmation: string | null;
  /** Captures proving the submission: screenshots, confirmations. */
  evidence: Evidence[];
  createdAt: string;
  updatedAt: string;
}

export interface ApplicationInput {
  id?: string;
  jobId?: unknown;
  resumeRef?: unknown;
}

export class Application {
  static create(input: ApplicationInput, { now = new Date().toISOString() } = {}): Application {
    const jobId = str(input.jobId);
    if (!jobId) throw new DomainError("application is missing required field: jobId");
    return {
      id: input.id ?? makeId("app"),
      jobId,
      status: "discovered",
      resumeRef: strOr(input.resumeRef, null),
      matchScore: null,
      matchReportPath: null,
      artifacts: { resume: null, coverLetter: null, notes: null },
      history: [],
      submittedAt: null,
      submissionPortal: null,
      submissionConfirmation: null,
      evidence: [],
      createdAt: now,
      updatedAt: now,
    };
  }

  /** Validate a loaded record. */
  static validate(app: Application): Application {
    if (!str(app.id)) throw new DomainError("application is missing required field: id");
    if (!str(app.jobId)) throw new DomainError("application is missing required field: jobId");
    if (!isStatus(app.status)) {
      throw new DomainError(`application has unknown status: ${String(app.status)}`);
    }
    app.submittedAt = strOr(app.submittedAt, null);
    app.submissionPortal = strOr(app.submissionPortal, null);
    app.submissionConfirmation = strOr(app.submissionConfirmation, null);
    app.evidence = Array.isArray(app.evidence) ? app.evidence : [];
    return app;
  }

  /** Immutable status move with history entry; enforces the machine. */
  static recordTransition(
    app: Application,
    to: Status,
    { at = new Date().toISOString(), note = null }: { at?: string; note?: string | null } = {}
  ): Application {
    assertTransition(app.status, to);
    return {
      ...app,
      status: to,
      updatedAt: at,
      history: [...app.history, { at, from: app.status, to, note }],
    };
  }
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function strOr<T>(v: unknown, fallback: T): string | T {
  const s = str(v);
  return s || fallback;
}
