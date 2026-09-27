import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";

import { EvidenceStore } from "../src/services/evidence.ts";
import { JsonCollection } from "../src/adapters/json-collection.ts";
import { Job, Application, type Job as JobRecord, type Application as AppRecord } from "../src/domain.ts";
import { withTmpDir } from "./helpers.ts";

async function make(root: string) {
  const jobs = new JsonCollection<JobRecord>({ dir: join(root, "jobs"), entityName: "job", validate: (r) => Job.validate(r) });
  const applications = new JsonCollection<AppRecord>({
    dir: join(root, "applications"),
    entityName: "application",
    validate: (r) => Application.validate(r),
  });
  const store = new EvidenceStore({ jobs, applications, workspaceRoot: root });
  return { jobs, applications, store };
}

async function seed(root: string) {
  const { jobs, applications, store } = await make(root);
  const job = await jobs.put(Job.create({ company: "Acme", title: "SRE", description: "Kafka", url: "https://jobs.acme.com/1" }));
  const app = await applications.put(Application.create({ jobId: job.id }));
  return { jobs, applications, store, job, app };
}

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

test("captureJob copies the file under jobs/<id>/evidence and records it on the job", async () => {
  await withTmpDir(async (root) => {
    const { store, jobs, job } = await seed(root);
    const shot = join(root, "posting.png");
    await writeFile(shot, PNG);
    const entry = await store.captureJob(job.id, shot, {
      kind: "jd-screenshot",
      url: "https://jobs.acme.com/1",
      note: "captured before applying",
      at: "2026-09-27T10:00:00.000Z",
    });
    assert.match(entry.id, /^ev-/);
    assert.match(entry.path, /^jobs\/[^/]+\/evidence\/20260927T100000-jd-screenshot-[a-z0-9]{4}\.png$/);
    assert.equal(entry.url, "https://jobs.acme.com/1");
    const stored = await jobs.get(job.id);
    assert.equal(stored.evidence.length, 1);
    assert.equal(stored.evidence[0]!.kind, "jd-screenshot");
    const bytes = await readFile(join(root, stored.evidence[0]!.path));
    assert.deepEqual(bytes, PNG); // content preserved byte-for-byte
  });
});

test("captureApplication stores under applications/<id>/evidence with unique names", async () => {
  await withTmpDir(async (root) => {
    const { store, applications, app } = await seed(root);
    const shot = join(root, "submit.png");
    await writeFile(shot, PNG);
    const a = await store.captureApplication(app.id, shot, { kind: "submit-screenshot", at: "2026-09-27T11:00:00.000Z" });
    const b = await store.captureApplication(app.id, shot, { kind: "submit-screenshot", at: "2026-09-27T11:05:00.000Z" });
    assert.notEqual(a.path, b.path);
    const stored = await applications.get(app.id);
    assert.equal(stored.evidence.length, 2);
  });
});

test("rejects disallowed file types and malformed kinds", async () => {
  await withTmpDir(async (root) => {
    const { store, job } = await seed(root);
    const exe = join(root, "evil.exe");
    await writeFile(exe, "MZ");
    await assert.rejects(() => store.captureJob(job.id, exe, { kind: "jd-screenshot" }), /file type/i);
    const png = join(root, "x.png");
    await writeFile(png, PNG);
    await assert.rejects(() => store.captureJob(job.id, png, { kind: "bad kind!" }), /kind/i);
    await assert.rejects(() => store.captureJob(job.id, png, { kind: "" }), /kind/i);
  });
});

test("unknown job or application ids are rejected", async () => {
  await withTmpDir(async (root) => {
    const { store } = await seed(root);
    const png = join(root, "x.png");
    await writeFile(png, PNG);
    await assert.rejects(() => store.captureJob("job-none", png, { kind: "jd-screenshot" }), /job-none/);
    await assert.rejects(() => store.captureApplication("app-none", png, { kind: "submit-screenshot" }), /app-none/);
  });
});

test("missing source file is rejected with a clear error", async () => {
  await withTmpDir(async (root) => {
    const { store, job } = await seed(root);
    await assert.rejects(
      () => store.captureJob(job.id, join(root, "nope.png"), { kind: "jd-screenshot" }),
      /nope\.png/
    );
  });
});
