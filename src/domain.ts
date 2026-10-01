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

// ---------------------------------------------------------------------------
// Pursuit verdict (agent's conversion-odds judgment alongside the match score)
// ---------------------------------------------------------------------------

export const PURSUIT_VERDICTS = ["green", "amber", "red"] as const;
export type PursuitVerdict = (typeof PURSUIT_VERDICTS)[number];

export interface Pursuit {
  verdict: PursuitVerdict;
  note: string | null;
  at: string;
}

export function isPursuitVerdict(value: string): value is PursuitVerdict {
  return (PURSUIT_VERDICTS as readonly string[]).includes(value);
}

export interface Application {
  id: string;
  jobId: string;
  status: Status;
  resumeRef: string | null;
  matchScore: number | null;
  matchReportPath: string | null;
  /** Conversion-odds verdict (college/brand/ML gates) set by the agent. */
  pursuit: Pursuit | null;
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
      pursuit: null,
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
    if (app.pursuit !== null && app.pursuit !== undefined) {
      if (!isPursuitVerdict(String(app.pursuit.verdict))) {
        throw new DomainError(
          `application pursuit verdict must be one of: ${PURSUIT_VERDICTS.join(", ")} (got: ${String(app.pursuit.verdict)})`
        );
      }
      app.pursuit = { verdict: app.pursuit.verdict, note: strOr(app.pursuit.note, null), at: str(app.pursuit.at) };
    } else {
      app.pursuit = null;
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

  /** Immutable pursuit-verdict update (overwrites any previous verdict). */
  static recordPursuit(
    app: Application,
    verdict: PursuitVerdict,
    { at = new Date().toISOString(), note = null }: { at?: string; note?: string | null } = {}
  ): Application {
    if (!isPursuitVerdict(verdict)) {
      throw new DomainError(`pursuit verdict must be one of: ${PURSUIT_VERDICTS.join(", ")} (got: ${String(verdict)})`);
    }
    return { ...app, pursuit: { verdict, note: note ?? null, at }, updatedAt: at };
  }
}

// ---------------------------------------------------------------------------
// Outreach (playbook discipline, tracked: who, when, follow-up due)
// ---------------------------------------------------------------------------

export const OUTREACH_TARGET_ROLES = ["hiring-manager", "recruiter", "referrer", "other"] as const;
export type OutreachTargetRole = (typeof OUTREACH_TARGET_ROLES)[number];

export const OUTREACH_CHANNELS = ["inmail", "connection-note", "dm", "email"] as const;
export type OutreachChannel = (typeof OUTREACH_CHANNELS)[number];

/** Playbook rule: follow up once, 4–5 days after the first message. */
export const FOLLOW_UP_AFTER_DAYS = 4;

export interface OutreachMessage {
  id: string;
  /** Person's name as addressed. */
  target: string;
  targetRole: OutreachTargetRole;
  channel: OutreachChannel;
  /** Playbook variant id the draft was based on (A1…F), when known. */
  variant: string | null;
  /** Linked application, when the outreach belongs to one. */
  appId: string | null;
  /** Target company (denormalized: outreach may precede an application). */
  company: string | null;
  note: string | null;
  sentAt: string;
  followUpSentAt: string | null;
  repliedAt: string | null;
}

export interface OutreachInput {
  id?: string;
  target?: unknown;
  targetRole?: unknown;
  channel?: unknown;
  variant?: unknown;
  appId?: unknown;
  company?: unknown;
  note?: unknown;
  sentAt?: string;
}

export class OutreachMessage {
  static create(input: OutreachInput, { now = new Date().toISOString() } = {}): OutreachMessage {
    const msg: OutreachMessage = {
      id: input.id ?? makeId("out", `${str(input.target)} ${str(input.company)}`),
      target: str(input.target),
      targetRole: (str(input.targetRole) || "other") as OutreachTargetRole,
      channel: str(input.channel) as OutreachChannel,
      variant: strOr(input.variant, null),
      appId: strOr(input.appId, null),
      company: strOr(input.company, null),
      note: strOr(input.note, null),
      sentAt: input.sentAt ?? now,
      followUpSentAt: null,
      repliedAt: null,
    };
    return OutreachMessage.validate(msg);
  }

  static validate(msg: OutreachMessage): OutreachMessage {
    if (!str(msg.target)) throw new DomainError("outreach message is missing required field: target");
    if (!OUTREACH_TARGET_ROLES.includes(msg.targetRole)) {
      throw new DomainError(`outreach targetRole must be one of: ${OUTREACH_TARGET_ROLES.join(", ")}`);
    }
    if (!OUTREACH_CHANNELS.includes(msg.channel)) {
      throw new DomainError(`outreach channel must be one of: ${OUTREACH_CHANNELS.join(", ")}`);
    }
    if (!str(msg.sentAt)) throw new DomainError("outreach message is missing required field: sentAt");
    msg.variant = strOr(msg.variant, null);
    msg.appId = strOr(msg.appId, null);
    msg.company = strOr(msg.company, null);
    msg.note = strOr(msg.note, null);
    msg.followUpSentAt = strOr(msg.followUpSentAt, null);
    msg.repliedAt = strOr(msg.repliedAt, null);
    return msg;
  }
}

/** When the one allowed follow-up becomes due (sentAt + FOLLOW_UP_AFTER_DAYS). */
export function followUpDueAt(sentAt: string): number {
  return Date.parse(sentAt) + FOLLOW_UP_AFTER_DAYS * 24 * 60 * 60 * 1000;
}

/** Follow-up discipline: exactly one, after the window, never after a reply. */
export function isFollowUpDue(msg: OutreachMessage, now = Date.now()): boolean {
  if (msg.repliedAt || msg.followUpSentAt) return false;
  return now >= followUpDueAt(msg.sentAt);
}

// ---------------------------------------------------------------------------
// Reminders (dated decisions that must resurface — a deadline in prose is a
// deadline nobody sees; these are read by the boot sequence)
// ---------------------------------------------------------------------------

export interface Reminder {
  id: string;
  /** The decision/action that comes due — imperative and self-contained. */
  title: string;
  /** When it should resurface (ISO date or full ISO timestamp). */
  dueAt: string;
  /** Linked application, when the reminder belongs to one. */
  appId: string | null;
  /** Context a future session needs: why this exists, what "done" looks like. */
  note: string | null;
  createdAt: string;
  /** Set via `reminders done`. */
  doneAt: string | null;
}

export interface ReminderInput {
  id?: string;
  title?: unknown;
  dueAt?: unknown;
  appId?: unknown;
  note?: unknown;
  createdAt?: string;
}

export class Reminder {
  static create(input: ReminderInput, { now = new Date().toISOString() } = {}): Reminder {
    const dueAt = str(input.dueAt);
    if (!dueAt) throw new DomainError("reminder is missing required field: dueAt");
    if (Number.isNaN(Date.parse(dueAt))) {
      throw new DomainError(`reminder dueAt must be a parseable date (ISO), got: ${dueAt}`);
    }
    const rem: Reminder = {
      id: input.id ?? makeId("rem", str(input.title)),
      title: str(input.title),
      dueAt,
      appId: strOr(input.appId, null),
      note: strOr(input.note, null),
      createdAt: input.createdAt ?? now,
      doneAt: null,
    };
    if (!rem.title) throw new DomainError("reminder is missing required field: title");
    return Reminder.validate(rem);
  }

  static validate(rem: Reminder): Reminder {
    if (!str(rem.title)) throw new DomainError("reminder is missing required field: title");
    if (!str(rem.dueAt) || Number.isNaN(Date.parse(rem.dueAt))) {
      throw new DomainError(`reminder dueAt must be a parseable date (ISO), got: ${String(rem.dueAt)}`);
    }
    if (!str(rem.id)) throw new DomainError("reminder is missing required field: id");
    if (!str(rem.createdAt)) throw new DomainError("reminder is missing required field: createdAt");
    rem.appId = strOr(rem.appId, null);
    rem.note = strOr(rem.note, null);
    rem.doneAt = strOr(rem.doneAt, null);
    return rem;
  }
}

/** A reminder is due once its time has arrived and it isn't done. */
export function isReminderDue(rem: Reminder, now = Date.now()): boolean {
  if (rem.doneAt) return false;
  return now >= Date.parse(rem.dueAt);
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function strOr<T>(v: unknown, fallback: T): string | T {
  const s = str(v);
  return s || fallback;
}
