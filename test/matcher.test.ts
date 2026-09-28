import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";

import { scoreMatch, grade } from "../src/services/matcher.ts";
import { DossierIndexer } from "../src/services/dossier.ts";
import { withTmpDir } from "./helpers.ts";

const JD = `
Senior Backend Engineer — Acme Corp

Responsibilities:
- Design and operate Kafka event streaming pipelines
- Build services in Go on Kubernetes
- Infrastructure as code with Terraform on AWS
`;

const DOSSIER = `
# Master Resume
Senior backend engineer with 12 years building distributed services.
Design and operate Kafka event streaming pipelines with exactly-once ingestion.
Build services in Go on Kubernetes. Infrastructure as code with Terraform on AWS.
`;

async function makeIndex(root: string, dossierText: string) {
  const dir = join(root, "dossier");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "master-resume.md"), dossierText);
  return new DossierIndexer(dir).index();
}

test("scoreMatch returns a strong grade when the dossier covers the JD", async () => {
  await withTmpDir(async (root) => {
    const index = await makeIndex(root, DOSSIER);
    const report = scoreMatch(JD, index);
    assert.equal(report.grade, "strong");
    assert.ok(report.score >= 75, `expected score >= 75, got ${report.score}`);
    assert.ok(report.matched.some((m) => m.term === "kafka"));
    assert.ok(report.coverage >= 0.75);
    assert.ok(report.at);
  });
});

test("scoreMatch lists missing JD terms", async () => {
  await withTmpDir(async (root) => {
    const index = await makeIndex(root, "# Master\nKafka streaming pipelines.");
    const report = scoreMatch(JD, index);
    assert.ok(report.missing.includes("terraform"));
    assert.ok(report.missing.includes("aws"));
    assert.ok(report.missing.includes("kubernetes"));
    assert.ok(report.matched.some((m) => m.term === "kafka"));
    assert.ok(report.score > 0 && report.score < 100);
  });
});

test("grade bands: strong >= 75, good >= 55, fair >= 35, stretch below", () => {
  assert.equal(grade(100), "strong");
  assert.equal(grade(75), "strong");
  assert.equal(grade(74.9), "good");
  assert.equal(grade(55), "good");
  assert.equal(grade(54), "fair");
  assert.equal(grade(35), "fair");
  assert.equal(grade(34), "stretch");
  assert.equal(grade(0), "stretch");
});

test("scoreMatch handles empty JD and empty index without crashing", async () => {
  await withTmpDir(async (root) => {
    const index = await makeIndex(root, DOSSIER);
    const emptyJd = scoreMatch("", index);
    assert.equal(emptyJd.score, 0);
    assert.equal(emptyJd.grade, "stretch");
    const emptyIndex = scoreMatch(JD, { files: [], keywords: [] });
    assert.equal(emptyIndex.score, 0);
    assert.deepEqual(emptyIndex.matched, []);
  });
});

test("scoreMatch suggests the best-matching resume to tailor from", async () => {
  await withTmpDir(async (root) => {
    const dir = join(root, "dossier");
    await mkdir(join(dir, "resumes"), { recursive: true });
    await writeFile(join(dir, "master-resume.md"), DOSSIER);
    await writeFile(join(dir, "resumes", "acme.md"), "# Acme tailored\nKafka Go Terraform AWS. Kafka Go Terraform AWS. Kafka on Kubernetes.");
    const indexer = new DossierIndexer(dir);
    const index = await indexer.index();
    const report = scoreMatch(JD, index, { indexer });
    assert.equal(report.grade, "strong");
    assert.ok(report.suggestions && report.suggestions.length >= 1);
    assert.equal(report.suggestions![0]!.path, "resumes/acme.md");
    assert.ok(["resume", "master-resume"].includes(report.suggestions![0]!.kind));
  });
});

test("scoreMatch does not credit terms that only appear in prep/chat/reference files", async () => {
  await withTmpDir(async (root) => {
    const dir = join(root, "dossier");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "master-resume.md"), "# Master\nKafka event streaming pipelines in Go.");
    await writeFile(
      join(dir, "interview-prep-guide.md"),
      "# Prep\nThe Acme loop may probe Terraform, AWS, and Kubernetes — study those."
    );
    const index = await new DossierIndexer(dir).index();
    const report = scoreMatch(JD, index);
    assert.ok(report.missing.includes("terraform"), "prep-only term counted as covered");
    assert.ok(report.missing.includes("aws"));
    assert.ok(report.missing.includes("kubernetes"));
    assert.ok(report.matched.some((m) => m.term === "kafka"));
  });
});

test("scoreMatch vocabulary is not capped, so common terms survive", async () => {
  await withTmpDir(async (root) => {
    const dir = join(root, "dossier");
    await mkdir(dir, { recursive: true });
    const filler = Array.from({ length: 200 }, (_, i) => `filler${i}`).join(" ");
    await writeFile(join(dir, "master-resume.md"), `# Master\n${filler} kafka systems distributed.`);
    const index = await new DossierIndexer(dir).index();
    const report = scoreMatch("Kafka systems distributed reliability", index);
    assert.ok(report.matched.some((m) => m.term === "systems"), `"systems" dropped — vocabulary still capped`);
    assert.ok(report.matched.some((m) => m.term === "distributed"));
    assert.ok(!report.missing.includes("systems"));
  });
});

test("scoreMatch reports the vocabulary scope it scored against", async () => {
  await withTmpDir(async (root) => {
    const dir = join(root, "dossier");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "master-resume.md"), DOSSIER);
    const index = await new DossierIndexer(dir).index();
    const report = scoreMatch(JD, index);
    assert.equal(report.vocabulary.source, "profile");
    assert.ok(report.vocabulary.terms > 0);
    // legacy v1 index without profileKeywords still scores, against the global set
    const legacy = scoreMatch(JD, { files: index.files, keywords: index.keywords });
    assert.equal(legacy.vocabulary.source, "all");
  });
});
