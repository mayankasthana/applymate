/**
 * Domain entities and rules. Pure data + pure functions: no I/O here.
 * Persistence, orchestration and presentation live in services/adapters.
 */

import { makeId } from "./ids.js";

export class DomainError extends Error {
  constructor(message) {
    super(message);
    this.name = "DomainError";
  }
}

// ---------------------------------------------------------------------------
// Job
// ---------------------------------------------------------------------------

export class Job {
  static create(input, { now = new Date().toISOString() } = {}) {
    const job = {
      id: input.id ?? makeId("job", `${input.company ?? ""} ${input.title ?? ""}`),
      company: str(input.company),
      title: str(input.title),
      description: str(input.description),
      location: strOr(input.location, null),
      url: strOr(input.url, null),
      addedAt: input.addedAt ?? now,
    };
    Job.validate(job, { requireId: false });
    if (job.url !== null && !/^https?:\/\/\S+$/.test(job.url)) {
      throw new DomainError(`job url must be an http(s) url, got: ${job.url}`);
    }
    return job;
  }

  /** Validate a loaded record (id included). */
  static validate(job, { requireId = true } = {}) {
    const missing = ["company", "title", "description"].filter((k) => !str(job[k]));
    if (missing.length) {
      throw new DomainError(`job is missing required fields: ${missing.join(", ")}`);
    }
    if (requireId && !str(job.id)) throw new DomainError("job is missing required field: id");
    if (!str(job.addedAt)) throw new DomainError("job is missing required field: addedAt");
    return job;
  }
}

// ---------------------------------------------------------------------------
// Application status machine
// ---------------------------------------------------------------------------

export const STATUSES = Object.freeze([
  "discovered",
  "matched",
  "tailoring",
  "ready",
  "submitted",
  "interviewing",
  "offer",
  "rejected",
  "closed",
]);

export const TERMINAL_STATUSES = Object.freeze(["rejected", "closed"]);

const TRANSITIONS = Object.freeze({
  discovered: ["matched", "closed"],
  matched: ["tailoring", "closed"],
  tailoring: ["ready", "closed"],
  ready: ["submitted", "closed"],
  submitted: ["interviewing", "rejected", "closed"],
  interviewing: ["offer", "rejected", "closed"],
  offer: ["closed"],
  rejected: [],
  closed: [],
});

export function canTransition(from, to) {
  return (TRANSITIONS[from] ?? []).includes(to);
}

export function assertTransition(from, to) {
  if (!canTransition(from, to)) {
    throw new DomainError(`illegal status transition ${from} -> ${to} (allowed: ${(TRANSITIONS[from] ?? []).join(", ") || "none"})`);
  }
  return true;
}

// ---------------------------------------------------------------------------
// Application
// ---------------------------------------------------------------------------

export class Application {
  static create(input, { now = new Date().toISOString() } = {}) {
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
      createdAt: now,
      updatedAt: now,
    };
  }

  /** Validate a loaded record. */
  static validate(app) {
    if (!str(app.id)) throw new DomainError("application is missing required field: id");
    if (!str(app.jobId)) throw new DomainError("application is missing required field: jobId");
    if (!STATUSES.includes(app.status)) {
      throw new DomainError(`application has unknown status: ${app.status}`);
    }
    return app;
  }

  /** Immutable status move with history entry; enforces the machine. */
  static recordTransition(app, to, { at = new Date().toISOString(), note = null } = {}) {
    assertTransition(app.status, to);
    return {
      ...app,
      status: to,
      updatedAt: at,
      history: [...app.history, { at, from: app.status, to, note }],
    };
  }
}

function str(v) {
  return typeof v === "string" ? v.trim() : "";
}

function strOr(v, fallback) {
  const s = str(v);
  return s || fallback;
}
