import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";

import { PipelineService } from "../src/services/pipeline.js";
import { JsonCollection, StoreError } from "../src/adapters/json-collection.js";
import { Job, Application } from "../src/domain.js";
import { withTmpDir } from "./helpers.js";

async function makeService(root) {
  const jobs = new JsonCollection({
    dir: join(root, "jobs"),
    entityName: "job",
    validate: (r) => Job.validate(r),
  });
  const applications = new JsonCollection({
    dir: join(root, "applications"),
    entityName: "application",
    validate: (r) => Application.validate(r),
  });
  return new PipelineService({ jobs, applications });
}

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
    await assert.rejects(() => svc.addJob({ ...JOB_INPUT, description: " " }), (err) => err.name === "DomainError");
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
    await assert.rejects(() => svc.startApplication("job-missing"), (err) => err instanceof StoreError && err.code === "NOT_FOUND");
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

test("move applies the status machine and persists history", async () => {
  await withTmpDir(async (root) => {
    const svc = await makeService(root);
    const job = await svc.addJob(JOB_INPUT);
    const app = await svc.startApplication(job.id);
    const moved = await svc.move(app.id, "matched", { note: "82% match" });
    assert.equal(moved.status, "matched");
    assert.equal(moved.history[0].note, "82% match");
    // durable: a fresh service sees the same state
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
    await assert.rejects(() => svc.move(app.id, "offer"), (err) => err.name === "DomainError");
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
    await assert.rejects(() => svc.attachArtifact(app.id, "video", "x.mp4"), /unknown artifact kind/i);
    await assert.rejects(() => svc.attachArtifact("app-none", "resume", "r.md"), (err) => err.code === "NOT_FOUND");
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
    assert.equal(board.discovered[0].id, appA.id);
    assert.equal(board.discovered[0].company, "Acme Corp");
    assert.equal(board.matched[0].title, "Staff SRE");
  });
});

test("listApplications filters by status", async () => {
  await withTmpDir(async (root) => {
    const svc = await makeService(root);
    const job = await svc.addJob(JOB_INPUT);
    const a = await svc.startApplication(job.id);
    await svc.startApplication(job.id, {}).catch(() => {});
    await svc.move(a.id, "closed");
    const closed = await svc.listApplications({ status: "closed" });
    assert.equal(closed.length, 1);
    assert.equal(closed[0].status, "closed");
  });
});
