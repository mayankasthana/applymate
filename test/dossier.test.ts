import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";

import { DossierIndexer, classifyRole, loadDossierIndex } from "../src/services/dossier.ts";
import { withTmpDir } from "./helpers.ts";

async function writeDossier(root: string): Promise<string> {
  const dir = join(root, "dossier");
  await mkdir(join(dir, "resumes"), { recursive: true });
  await mkdir(join(dir, "facts"), { recursive: true });
  await writeFile(
    join(dir, "master-resume.md"),
    [
      "# Priya Sharma — Master Resume",
      "",
      "## Summary",
      "Staff engineer. Kafka, Kubernetes, Go, distributed systems.",
      "",
      "## Experience",
      "- Built event-driven ingestion on Kafka with exactly-once semantics.",
      "- Ran Kubernetes fleets; cut p99 latency 40%.",
    ].join("\n")
  );
  await writeFile(
    join(dir, "resumes", "acme.md"),
    [
      "# Acme Corp — Senior Backend Engineer",
      "",
      "Tailored for Acme: Kafka, Go, Terraform, AWS.",
      "- Shipped Terraform modules running on AWS EKS.",
    ].join("\n")
  );
  await writeFile(
    join(dir, "facts", "skills.md"),
    ["# Skills", "", "- Languages: Go, Python, TypeScript", "- Infra: Kubernetes, Terraform, AWS"].join("\n")
  );
  await writeFile(join(dir, "photo.png"), Buffer.from([0x89, 0x50]));
  await writeFile(join(dir, ".secret.md"), "# hidden");
  return dir;
}

test("indexDossier walks the tree, indexing only md/txt, skipping hidden files", async () => {
  await withTmpDir(async (root) => {
    const dir = await writeDossier(root);
    const index = await new DossierIndexer(dir).index();
    assert.equal(index.files.length, 3);
    assert.ok(index.files.every((f) => /\.(md|txt)$/.test(f.path)));
    assert.ok(!index.files.some((f) => f.path.includes(".secret")));
  });
});

test("indexDossier classifies master resume, tailored resumes, and fact sheets", async () => {
  await withTmpDir(async (root) => {
    const dir = await writeDossier(root);
    const index = await new DossierIndexer(dir).index();
    const byPath = new Map(index.files.map((f) => [f.path, f]));
    assert.equal(byPath.get("master-resume.md")!.kind, "master-resume");
    assert.equal(byPath.get("resumes/acme.md")!.kind, "resume");
    assert.equal(byPath.get("facts/skills.md")!.kind, "skills");
  });
});

test("indexDossier captures the H1 title and markdown section headings", async () => {
  await withTmpDir(async (root) => {
    const dir = await writeDossier(root);
    const index = await new DossierIndexer(dir).index();
    const master = index.files.find((f) => f.path === "master-resume.md")!;
    assert.equal(master.title, "Priya Sharma — Master Resume");
    assert.deepEqual(master.sections, ["Summary", "Experience"]);
  });
});

test("indexDossier aggregates keywords and word stats", async () => {
  await withTmpDir(async (root) => {
    const dir = await writeDossier(root);
    const index = await new DossierIndexer(dir).index();
    const terms = index.keywords.map((k) => k.term);
    assert.ok(terms.includes("kafka"), `kafka missing from ${JSON.stringify(index.keywords)}`);
    assert.equal(index.stats.files, 3);
    assert.ok(index.stats.words > 20);
    assert.equal(index.root, dir);
    assert.ok(index.indexedAt);
  });
});

test("search ranks the most relevant file first and supports no-hit queries", async () => {
  await withTmpDir(async (root) => {
    const dir = await writeDossier(root);
    const indexer = new DossierIndexer(dir);
    const index = await indexer.index();
    const hits = indexer.search(index, "terraform aws");
    assert.ok(hits.length >= 1);
    assert.equal(hits[0]!.path, "resumes/acme.md");
    assert.ok(hits[0]!.score > 0);
    assert.deepEqual(indexer.search(index, "quantumn computing zzz"), []);
  });
});

test("save/load index roundtrips through workspace", async () => {
  await withTmpDir(async (root) => {
    const dir = await writeDossier(root);
    const workspace = join(root, "workspace");
    const index = await new DossierIndexer(dir).index();
    await new DossierIndexer(dir).save(index, join(workspace, "dossier", "index.json"));
    const loaded = await loadDossierIndex(join(workspace, "dossier", "index.json"));
    assert.equal(loaded.root, index.root);
    assert.equal(loaded.files.length, 3);
    const raw = JSON.parse(await readFile(join(workspace, "dossier", "index.json"), "utf8"));
    assert.ok(raw.indexedAt);
  });
});

test("classifyRole marks experience docs profile and prep/chat/archive docs reference", () => {
  // profile: anything that reads like evidence of real work
  assert.equal(classifyRole("master-resume.md"), "profile");
  assert.equal(classifyRole("resumes/acme.md"), "profile");
  assert.equal(classifyRole("00-employment-facts.md"), "profile");
  assert.equal(classifyRole("01-nrt-events-family.md"), "profile");
  assert.equal(classifyRole("17-git-go-services.md"), "profile");
  // reference: prep, chat/email archives, raw notes, cover letters, copies of other JDs
  assert.equal(classifyRole("interview-prep-guide.md"), "reference");
  assert.equal(classifyRole("Confluent-coding-prep.md"), "reference");
  assert.equal(classifyRole("prep-plan-sentinelone.md"), "reference");
  assert.equal(classifyRole("09-chat-2026.md"), "reference");
  assert.equal(classifyRole("14-email-archive.md"), "reference");
  assert.equal(classifyRole("19-sublime-notes.md"), "reference");
  assert.equal(classifyRole("sublime-notes-raw/unsaved_032.txt"), "reference");
  assert.equal(classifyRole("cover-blurb-digitalocean-staff-ai.md"), "reference");
  assert.equal(classifyRole("07-google-drive-findings.md"), "reference");
  assert.equal(classifyRole("helfie-reply.md"), "reference");
});

test("index tags each file with a role and counts the split in stats", async () => {
  await withTmpDir(async (root) => {
    const dir = join(root, "dossier");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "master-resume.md"), "# Master\nKafka Go distributed systems.");
    await writeFile(join(dir, "interview-prep-guide.md"), "# Prep\nPractice questions for the loop.");
    const index = await new DossierIndexer(dir).index();
    const byPath = new Map(index.files.map((f) => [f.path, f]));
    assert.equal(byPath.get("master-resume.md")!.role, "profile");
    assert.equal(byPath.get("interview-prep-guide.md")!.role, "reference");
    assert.equal(index.stats.profileFiles, 1);
    assert.equal(index.stats.referenceFiles, 1);
    assert.equal(index.version, 2);
  });
});

test("profileKeywords come from profile files only", async () => {
  await withTmpDir(async (root) => {
    const dir = join(root, "dossier");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "master-resume.md"), "# Master\nKafka streaming. Cobol migration long ago.");
    await writeFile(
      join(dir, "interview-prep-guide.md"),
      "# Prep\nStudy hadoop, hive, flink, presto, zeal, quartz, and zendframework for the loop."
    );
    const index = await new DossierIndexer(dir).index();
    const terms = index.profileKeywords.map((k) => k.term);
    assert.ok(terms.includes("kafka"));
    assert.ok(terms.includes("cobol"));
    assert.ok(!terms.includes("zendframework"), `prep-only term leaked: ${terms.join(",")}`);
    assert.ok(!terms.includes("hadoop"));
  });
});

test("profileKeywords are not capped at 200 terms", async () => {
  await withTmpDir(async (root) => {
    const dir = join(root, "dossier");
    await mkdir(dir, { recursive: true });
    const terms = Array.from({ length: 300 }, (_, i) => `skill${i}`);
    await writeFile(join(dir, "master-resume.md"), `# Master\n${terms.join(" ")}`);
    const index = await new DossierIndexer(dir).index();
    const vocab = new Set(index.profileKeywords.map((k) => k.term));
    assert.ok(vocab.has("skill299"), "term beyond 200 dropped from profile vocabulary");
  });
});

test("explicit globs override the heuristic role classification", async () => {
  await withTmpDir(async (root) => {
    const dir = join(root, "dossier");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "master-resume.md"), "# Master\nKafka.");
    await writeFile(join(dir, "coding-prep.md"), "# Prep\nPractice drills.");
    const forced = await new DossierIndexer(dir, { referenceGlobs: ["master-resume.md"] }).index();
    const forcedByPath = new Map(forced.files.map((f) => [f.path, f]));
    assert.equal(forcedByPath.get("master-resume.md")!.role, "reference");
    const whitelist = await new DossierIndexer(dir, { profileGlobs: ["*prep*"], referenceGlobs: ["*"] }).index();
    const whitelistByPath = new Map(whitelist.files.map((f) => [f.path, f]));
    assert.equal(whitelistByPath.get("coding-prep.md")!.role, "profile");
    assert.equal(whitelistByPath.get("master-resume.md")!.role, "reference");
  });
});
