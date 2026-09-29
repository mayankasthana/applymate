import { test } from "node:test";
import assert from "node:assert/strict";

import {
  Job,
  Application,
  DomainError,
  STATUSES,
  TERMINAL_STATUSES,
  canTransition,
  assertTransition,
} from "../src/domain.ts";

const JOB_INPUT = {
  company: "Acme Corp",
  title: "Senior Backend Engineer",
  description: "# About\n\nBuild distributed systems in Go and Kubernetes.",
};

test("Job.create validates required fields and fills defaults", () => {
  const job = Job.create(JOB_INPUT, { now: "2026-09-27T00:00:00Z" });
  assert.match(job.id, /^job-acme-corp-senior-backend-engineer-[a-z0-9]{4}$/);
  assert.equal(job.company, "Acme Corp");
  assert.equal(job.title, "Senior Backend Engineer");
  assert.ok(job.description.length > 0);
  assert.equal(job.location, null);
  assert.equal(job.url, null);
  assert.equal(job.addedAt, "2026-09-27T00:00:00Z");
  assert.equal(job.matchScore, null);
});

test("Job.create requires company, title and a non-empty description", () => {
  assert.throws(() => Job.create({ ...JOB_INPUT, company: "  " }), DomainError);
  assert.throws(() => Job.create({ ...JOB_INPUT, title: undefined }), DomainError);
  assert.throws(() => Job.create({ ...JOB_INPUT, description: "   " }), DomainError);
  assert.throws(() => Job.create({ ...JOB_INPUT, url: "not-a-url" }), DomainError);
});

test("Job.create accepts https job posting urls", () => {
  const job = Job.create({ ...JOB_INPUT, url: "https://jobs.acme.com/123" });
  assert.equal(job.url, "https://jobs.acme.com/123");
});

test("Job.validate normalizes legacy records missing match fields", () => {
  const job = Job.validate({
    id: "job-x",
    company: "A",
    title: "B",
    description: "d",
    location: null,
    url: null,
    addedAt: "t",
  } as never);
  assert.equal(job.matchScore, null);
  assert.equal(job.matchReportPath, null);
  assert.equal(job.matchedAt, null);
});

test("Job.validate rejects a loaded record missing required fields", () => {
  assert.throws(() => Job.validate({ id: "job-x", company: "A", title: "B" } as never), DomainError);
  assert.doesNotThrow(() =>
    Job.validate({ id: "job-x", company: "A", title: "B", description: "d", location: null, url: null, addedAt: "t" } as never)
  );
});

test("status machine: happy path is walkable", () => {
  const path = ["discovered", "matched", "tailoring", "ready", "submitted", "interviewing", "offer"] as const;
  for (let i = 0; i < path.length - 1; i++) {
    assert.ok(canTransition(path[i]!, path[i + 1]!), `${path[i]} -> ${path[i + 1]}`);
  }
});

test("status machine: every non-terminal status can be closed", () => {
  for (const status of STATUSES) {
    if (!TERMINAL_STATUSES.includes(status)) {
      assert.ok(canTransition(status, "closed"), `${status} -> closed`);
    }
  }
  assert.ok(canTransition("submitted", "rejected"));
  assert.ok(canTransition("interviewing", "rejected"));
});

test("status machine: illegal jumps are rejected", () => {
  assert.equal(canTransition("discovered", "offer"), false);
  assert.equal(canTransition("ready", "matched"), false);
  assert.equal(canTransition("rejected", "submitted"), false);
  assert.equal(canTransition("offer", "interviewing"), false);
  assert.throws(() => assertTransition("ready", "matched"), DomainError);
});

test("Application.create starts in discovered with empty artifacts and history", () => {
  const app = Application.create({ jobId: "job-acme-xxxx", resumeRef: "resumes/acme.md" }, { now: "2026-09-27T00:00:00Z" });
  assert.match(app.id, /^app-[a-z0-9]{4}$/);
  assert.equal(app.jobId, "job-acme-xxxx");
  assert.equal(app.status, "discovered");
  assert.equal(app.resumeRef, "resumes/acme.md");
  assert.deepEqual(app.artifacts, { resume: null, coverLetter: null, notes: null });
  assert.deepEqual(app.history, []);
  assert.equal(app.matchScore, null);
  assert.equal(app.createdAt, app.updatedAt);
});

test("Application.create requires a jobId", () => {
  assert.throws(() => Application.create({}), DomainError);
});

test("Application.recordTransition appends history and moves status", () => {
  const app = Application.create({ jobId: "job-acme-xxxx" }, { now: "2026-09-27T00:00:00Z" });
  const moved = Application.recordTransition(app, "matched", { at: "2026-09-27T01:00:00Z", note: "scored 82" });
  assert.equal(moved.status, "matched");
  assert.equal(moved.history.length, 1);
  assert.equal(moved.history[0]!.from, "discovered");
  assert.equal(moved.history[0]!.to, "matched");
  assert.equal(moved.history[0]!.note, "scored 82");
  assert.equal(moved.updatedAt, "2026-09-27T01:00:00Z");
  assert.equal(app.status, "discovered"); // original untouched (immutable update)
});

test("Application.recordTransition refuses illegal moves", () => {
  const app = Application.create({ jobId: "job-acme-xxxx" });
  assert.throws(() => Application.recordTransition(app, "offer"), DomainError);
});

test("Application.recordPursuit stores verdict/note immutably and rejects unknown verdicts", () => {
  const app = Application.create({ jobId: "job-acme-xxxx" }, { now: "2026-09-27T00:00:00Z" });
  const scored = Application.recordPursuit(app, "amber", { at: "2026-09-30T10:00:00Z", note: "referral required" });
  assert.deepEqual(scored.pursuit, { verdict: "amber", note: "referral required", at: "2026-09-30T10:00:00Z" });
  assert.equal(app.pursuit, null); // original untouched
  const again = Application.recordPursuit(scored, "red", { at: "2026-09-30T11:00:00Z", note: null });
  assert.equal(again.pursuit?.verdict, "red");
  assert.throws(() => Application.recordPursuit(app, "mauve" as never), /pursuit verdict/i);
});

test("Application.validate rejects a record with an unknown pursuit verdict", () => {
  const app = Application.create({ jobId: "job-acme-xxxx" });
  assert.equal(Application.validate(app).pursuit, null);
  assert.throws(
    () => Application.validate({ ...app, pursuit: { verdict: "sparkly", note: null, at: "t" } } as never),
    /pursuit verdict/i
  );
});
