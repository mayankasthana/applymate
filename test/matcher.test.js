import { test } from "node:test";
import assert from "node:assert/strict";

import { scoreMatch, grade } from "../src/services/matcher.js";
import { DossierIndexer } from "../src/services/dossier.js";
import { withTmpDir } from "./helpers.js";
import { join } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";

const JD = `
Senior Backend Engineer — Acme Corp

Responsibilities:
- Design and operate Kafka event streaming pipelines
- Build services in Go on Kubernetes
- Infrastructure as code with Terraform on AWS
`;

async function makeIndex(root, dossierText) {
  const dir = join(root, "dossier");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "master-resume.md"), dossierText);
  return new DossierIndexer(dir).index();
}

const DOSSIER = `
# Master Resume
Kafka, Kubernetes, Go, Terraform, AWS.
Kafka streaming. Go services. Terraform modules on AWS.
`;

test("scoreMatch returns a strong grade when the dossier covers the JD", async () => {
  await withTmpDir(async (root) => {
    const index = await makeIndex(root, DOSSIER);
    const report = scoreMatch(JD, index);
    assert.equal(report.score, 100);
    assert.equal(report.grade, "strong");
    assert.ok(report.matched.some((m) => m.term === "kafka"));
    assert.deepEqual(report.missing, []);
    assert.ok(report.at);
  });
});

test("scoreMatch lists missing JD terms sorted by JD frequency", async () => {
  await withTmpDir(async (root) => {
    const index = await makeIndex(root, "# Master\nKafka streaming pipelines.");
    const report = scoreMatch(JD, index);
    assert.ok(report.missing.includes("terraform"));
    assert.ok(report.missing.includes("aws"));
    assert.ok(report.missing.includes("kubernetes"));
    // kafka IS matched
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

test("matchJob suggests the best-matching resume to tailor from", async () => {
  await withTmpDir(async (root) => {
    const dir = join(root, "dossier");
    await mkdir(join(dir, "resumes"), { recursive: true });
    await writeFile(join(dir, "master-resume.md"), DOSSIER);
    await writeFile(
      join(dir, "resumes", "acme.md"),
      "# Acme tailored\nKafka Go Terraform AWS. Kafka Go Terraform AWS. Kafka on Kubernetes."
    );
    const indexer = new DossierIndexer(dir);
    const index = await indexer.index();
    const report = scoreMatch(JD, index, { indexer });
    assert.equal(report.grade, "strong");
    assert.ok(report.suggestions.length >= 1);
    assert.equal(report.suggestions[0].path, "resumes/acme.md");
    assert.ok(["resume", "master-resume"].includes(report.suggestions[0].kind));
  });
});
