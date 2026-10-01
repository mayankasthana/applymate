import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";

import { PipelineService, RelevanceError, isStale, daysSince } from "../src/services/pipeline.ts";
import { JsonCollection, type Collection } from "../src/adapters/json-collection.ts";
import { Job, Application, type Job as JobRecord, type Application as AppRecord } from "../src/domain.ts";
import { withTmpDir } from "./helpers.ts";

async function makeCollections(root: string): Promise<{ jobs: Collection<JobRecord>; applications: Collection<AppRecord> }> {
  const jobs = new JsonCollection<JobRecord>({ dir: join(root, "jobs"), entityName: "job", validate: (r) => Job.validate(r) });
  const applications = new JsonCollection<AppRecord>({
    dir: join(root, "applications"),
    entityName: "application",
    validate: (r) => Application.validate(r),
  });
  return { jobs, applications };
}

const makeService = async (root: string, minMatchScore = 0) =>
  new PipelineService({ ...(await makeCollections(root)), minMatchScore });

const JOB_INPUT = {
  company: "Acme Corp",
  title: "Senior Backend Engineer",
  description: "Kafka, Go, Kubernetes, Terraform.",
};

test("addJob persists a valid job and getJob/listJobs roundtrip it", async () => {
  await withTmpDir(async (root) => {
    const svc = await makeService(root);
    const job = await svc.addJob(JOB_INPUT);
    assert.match(job.id, /^job-acme-corp-/);
    const fetched = await svc.getJob(job.id);
    assert.equal(fetched.title, "Senior Backend Engineer");
    assert.equal((await svc.listJobs()).length, 1);
  });
});

test("addJob rejects invalid input with DomainError", async () => {
  await withTmpDir(async (root) => {
    const svc = await makeService(root);
    await assert.rejects(() => svc.addJob({ ...JOB_INPUT, description: " " }), (err: unknown) => (err as Error).name === "DomainError");
  });
});

test("startApplication creates a discovered application referencing the job", async () => {
  await withTmpDir(async (root) => {
    const svc = await makeService(root);
    const job = await svc.addJob(JOB_INPUT);
    const app = await svc.startApplication(job.id, { resumeRef: "resumes/acme.md" });
    assert.equal(app.status, "discovered");
    assert.equal(app.jobId, job.id);
    assert.equal(app.resumeRef, "resumes/acme.md");
    const fetched = await svc.getApplication(app.id);
    assert.equal(fetched.status, "discovered");
  });
});

test("startApplication refuses unknown jobs and duplicate open applications", async () => {
  await withTmpDir(async (root) => {
    const svc = await makeService(root);
    const job = await svc.addJob(JOB_INPUT);
    await assert.rejects(
      () => svc.startApplication("job-missing"),
      (err: unknown) => (err as { code?: string }).code === "NOT_FOUND"
    );
    await svc.startApplication(job.id);
    await assert.rejects(() => svc.startApplication(job.id), /already has an open application/i);
  });
});

test("a new application may start after the previous one closed", async () => {
  await withTmpDir(async (root) => {
    const svc = await makeService(root);
    const job = await svc.addJob(JOB_INPUT);
    const first = await svc.startApplication(job.id);
    await svc.move(first.id, "closed", { note: "role filled" });
    const second = await svc.startApplication(job.id);
    assert.notEqual(first.id, second.id);
  });
});

test("relevance gate: below-floor scores are refused, force bypasses", async () => {
  await withTmpDir(async (root) => {
    const svc = await makeService(root, 60);
    const job = await svc.addJob(JOB_INPUT);
    await svc.setJobMatch(job.id, { score: 42 });
    await assert.rejects(() => svc.startApplication(job.id), RelevanceError);
    const app = await svc.startApplication(job.id, { force: true });
    assert.equal(app.status, "discovered");
  });
});

test("relevance gate: at/above floor passes; unscored jobs pass", async () => {
  await withTmpDir(async (root) => {
    const svc = await makeService(root, 60);
    const atFloor = await svc.addJob(JOB_INPUT);
    await svc.setJobMatch(atFloor.id, { score: 60 });
    await svc.startApplication(atFloor.id);

    const unscored = await svc.addJob({ ...JOB_INPUT, company: "Globex" });
    await svc.startApplication(unscored.id);
  });
});

test("setJobMatch persists score and timestamp on the job", async () => {
  await withTmpDir(async (root) => {
    const svc = await makeService(root);
    const job = await svc.addJob(JOB_INPUT);
    const updated = await svc.setJobMatch(job.id, { score: 82.4, reportPath: "jobs/x/match.json", at: "t0" });
    assert.equal(updated.matchScore, 82);
    assert.equal(updated.matchReportPath, "jobs/x/match.json");
    assert.equal(updated.matchedAt, "t0");
  });
});

test("move applies the status machine and persists history", async () => {
  await withTmpDir(async (root) => {
    const svc = await makeService(root);
    const job = await svc.addJob(JOB_INPUT);
    const app = await svc.startApplication(job.id);
    const moved = await svc.move(app.id, "matched", { note: "82% match" });
    assert.equal(moved.status, "matched");
    assert.equal(moved.history[0]!.note, "82% match");
    const svc2 = await makeService(root);
    const refetched = await svc2.getApplication(app.id);
    assert.equal(refetched.status, "matched");
    assert.equal(refetched.history.length, 1);
  });
});

test("move rejects illegal transitions without persisting anything", async () => {
  await withTmpDir(async (root) => {
    const svc = await makeService(root);
    const job = await svc.addJob(JOB_INPUT);
    const app = await svc.startApplication(job.id);
    await assert.rejects(() => svc.move(app.id, "offer"), (err: unknown) => (err as Error).name === "DomainError");
    const svc2 = await makeService(root);
    const refetched = await svc2.getApplication(app.id);
    assert.equal(refetched.status, "discovered");
    assert.equal(refetched.history.length, 0);
  });
});

test("moving to ready requires a tailored resume artifact", async () => {
  await withTmpDir(async (root) => {
    const svc = await makeService(root);
    const job = await svc.addJob(JOB_INPUT);
    const app = await svc.startApplication(job.id);
    await svc.move(app.id, "matched");
    await svc.move(app.id, "tailoring");
    await assert.rejects(() => svc.move(app.id, "ready"), /tailored resume/i);
    await svc.attachArtifact(app.id, "resume", "applications/x/resume.md");
    await svc.move(app.id, "ready");
  });
});

test("attachArtifact validates kind and unknown applications", async () => {
  await withTmpDir(async (root) => {
    const svc = await makeService(root);
    const job = await svc.addJob(JOB_INPUT);
    const app = await svc.startApplication(job.id);
    await svc.attachArtifact(app.id, "coverLetter", "applications/x/cover-letter.md");
    await assert.rejects(() => svc.attachArtifact(app.id, "video" as never, "x.mp4"), /artifact kind/i);
    await assert.rejects(
      () => svc.attachArtifact("app-none", "resume", "r.md"),
      (err: unknown) => (err as { code?: string }).code === "NOT_FOUND"
    );
  });
});

test("setMatch records score and report path", async () => {
  await withTmpDir(async (root) => {
    const svc = await makeService(root);
    const job = await svc.addJob(JOB_INPUT);
    const app = await svc.startApplication(job.id);
    const updated = await svc.setMatch(app.id, { score: 82, reportPath: "applications/x/match.json" });
    assert.equal(updated.matchScore, 82);
    assert.equal(updated.matchReportPath, "applications/x/match.json");
  });
});

test("pipeline groups applications by status with job details joined", async () => {
  await withTmpDir(async (root) => {
    const svc = await makeService(root);
    const jobA = await svc.addJob(JOB_INPUT);
    const jobB = await svc.addJob({ ...JOB_INPUT, company: "Globex", title: "Staff SRE" });
    const appA = await svc.startApplication(jobA.id);
    const appB = await svc.startApplication(jobB.id);
    await svc.move(appB.id, "matched");
    const board = await svc.pipeline();
    assert.equal(board.discovered.length, 1);
    assert.equal(board.matched.length, 1);
    assert.equal(board.discovered[0]!.id, appA.id);
    assert.equal(board.discovered[0]!.company, "Acme Corp");
    assert.equal(board.matched[0]!.title, "Staff SRE");
  });
});

test("pipeline exposes the job posting url and falls back to the job-level match score", async () => {
  await withTmpDir(async (root) => {
    const svc = await makeService(root);
    const jobA = await svc.addJob({ ...JOB_INPUT, url: "https://jobs.example.com/a" });
    const jobB = await svc.addJob({ ...JOB_INPUT, company: "Globex", title: "Staff SRE" });
    await svc.setJobMatch(jobA.id, { score: 82 });
    const appA = await svc.startApplication(jobA.id);
    const appB = await svc.startApplication(jobB.id);
    await svc.setMatch(appB.id, { score: 64 });
    const board = await svc.pipeline();
    assert.equal(board.discovered.length, 2);
    const a = board.discovered.find((x) => x.id === appA.id)!;
    assert.equal(a.jobUrl, "https://jobs.example.com/a");
    assert.equal(a.matchScore, 82, "job-level score is the display fallback");
    const b = board.discovered.find((x) => x.id === appB.id)!;
    assert.equal(b.jobUrl, null);
    assert.equal(b.matchScore, 64, "app-level score wins over the job-level fallback");
  });
});

test("markSubmitted records time/portal/confirmation and moves ready -> submitted", async () => {
  await withTmpDir(async (root) => {
    const svc = await makeService(root);
    const job = await svc.addJob(JOB_INPUT);
    const app = await svc.startApplication(job.id);
    for (const s of ["matched", "tailoring"] as const) await svc.move(app.id, s);
    await svc.attachArtifact(app.id, "resume", "applications/x/resume.md");
    await svc.move(app.id, "ready");

    const done = await svc.markSubmitted(app.id, {
      at: "2026-09-27T14:30:00.000Z",
      portal: "Workday",
      confirmation: "WD-12345",
    });
    assert.equal(done.status, "submitted");
    assert.equal(done.submittedAt, "2026-09-27T14:30:00.000Z");
    assert.equal(done.submissionPortal, "Workday");
    assert.equal(done.submissionConfirmation, "WD-12345");
    assert.equal(done.history.at(-1)!.to, "submitted");
  });
});

test("markSubmitted refuses illegal jumps (discovered -> submitted) and changes nothing", async () => {
  await withTmpDir(async (root) => {
    const svc = await makeService(root);
    const job = await svc.addJob(JOB_INPUT);
    const app = await svc.startApplication(job.id);
    await assert.rejects(() => svc.markSubmitted(app.id, { at: "t" }), (err: unknown) => (err as Error).name === "DomainError");
    const refetched = await svc.getApplication(app.id);
    assert.equal(refetched.submittedAt, null);
    assert.equal(refetched.status, "discovered");
  });
});

test("markSubmitted on an already-submitted application just updates the details", async () => {
  await withTmpDir(async (root) => {
    const svc = await makeService(root);
    const job = await svc.addJob(JOB_INPUT);
    const app = await svc.startApplication(job.id);
    for (const s of ["matched", "tailoring"] as const) await svc.move(app.id, s);
    await svc.attachArtifact(app.id, "resume", "applications/x/resume.md");
    await svc.move(app.id, "ready");
    await svc.markSubmitted(app.id, { at: "t1", portal: "Greenhouse" });
    const again = await svc.markSubmitted(app.id, { confirmation: "GH-9", at: "t1" });
    assert.equal(again.status, "submitted");
    assert.equal(again.history.filter((h) => h.to === "submitted").length, 1);
    assert.equal(again.submissionConfirmation, "GH-9");
  });
});

test("listApplications filters by status", async () => {
  await withTmpDir(async (root) => {
    const svc = await makeService(root);
    const job = await svc.addJob(JOB_INPUT);
    const a = await svc.startApplication(job.id);
    await svc.move(a.id, "closed");
    const closed = await svc.listApplications({ status: "closed" });
    assert.equal(closed.length, 1);
    assert.equal(closed[0]!.status, "closed");
  });
});

test("setPursuit stores verdict/note/timestamp and pipeline() exposes it", async () => {
  await withTmpDir(async (root) => {
    const svc = await makeService(root);
    const job = await svc.addJob(JOB_INPUT);
    const app = await svc.startApplication(job.id);
    const updated = await svc.setPursuit(app.id, "green", { note: "pure infra role, no ML gate", at: "t0" });
    assert.equal(updated.pursuit?.verdict, "green");
    assert.equal(updated.pursuit?.note, "pure infra role, no ML gate");
    assert.equal(updated.pursuit?.at, "t0");
    const refetched = await makeService(root).then((s) => s.getApplication(app.id));
    assert.equal(refetched.pursuit?.verdict, "green");
    const board = await svc.pipeline();
    assert.equal(board.discovered[0]!.pursuit?.verdict, "green");
  });
});

test("setPursuit overwrites a previous verdict and validates input", async () => {
  await withTmpDir(async (root) => {
    const svc = await makeService(root);
    const job = await svc.addJob(JOB_INPUT);
    const app = await svc.startApplication(job.id);
    await svc.setPursuit(app.id, "amber", { note: null });
    const updated = await svc.setPursuit(app.id, "red", { note: "ML-titled role" });
    assert.equal(updated.pursuit?.verdict, "red");
    assert.equal(updated.pursuit?.note, "ML-titled role");
    assert.rejects(() => svc.setPursuit(app.id, "mauve" as never), /pursuit verdict/i);
    await assert.rejects(() => svc.setPursuit("app-none", "green"), (err: unknown) => (err as { code?: string }).code === "NOT_FOUND");
  });
});

// -- staleness ----------------------------------------------------------------

test("isStale flags backlog cards untouched past the threshold", () => {
  const old = { status: "discovered" as const, lastMovedAt: "2026-09-01T00:00:00.000Z" };
  const now = Date.parse("2026-10-01T00:00:00.000Z");
  assert.equal(isStale(old, { now }), true);
  assert.equal(isStale({ ...old, lastMovedAt: "2026-09-25T00:00:00.000Z" }, { now }), false);
  assert.equal(isStale(old, { now, staleDays: 90 }), false);
});

test("isStale ignores applications already handed to the employer", () => {
  const old = { status: "submitted" as const, lastMovedAt: "2026-01-01T00:00:00.000Z" };
  const now = Date.parse("2026-10-01T00:00:00.000Z");
  // a long silence after submitting is the employer's latency, not agent rot
  for (const status of ["submitted", "interviewing", "offer", "rejected", "closed"] as const) {
    assert.equal(isStale({ status, lastMovedAt: old.lastMovedAt }, { now }), false, status);
  }
});

test("daysSince never goes negative on a future timestamp", () => {
  const future = new Date(Date.now() + 86_400_000).toISOString();
  assert.equal(daysSince(future), 0);
  assert.equal(daysSince(null), null);
  assert.equal(daysSince("not-a-date"), null);
});

test("the board reports lastMovedAt from status history, not the last write", async () => {
  await withTmpDir(async (root) => {
    const svc = await makeService(root);
    const job = await svc.addJob(JOB_INPUT);
    const app = await svc.startApplication(job.id);
    await svc.move(app.id, "closed", { at: "2026-09-05T00:00:00.000Z", });
    // a later write that is not a status move must not reset the clock
    const touched = await svc.setPursuit(app.id, "green", { at: "2026-09-30T00:00:00.000Z" });
    const card = (await svc.pipeline()).closed[0]!;
    assert.equal(card.lastMovedAt, "2026-09-05T00:00:00.000Z");
    assert.equal(card.updatedAt, touched.updatedAt);
    assert.notEqual(card.lastMovedAt, card.updatedAt);
  });
});
