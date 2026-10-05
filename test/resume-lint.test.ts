import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";

import {
  baselineFacts,
  employerName,
  extractEmploymentFacts,
  factDrift,
  lintFilenames,
  lintResumeMarkdown,
  normalizeCompany,
  ownerAppId,
  RULES,
  errorsIn,
  ResumeLintService,
} from "../src/services/resume-lint.ts";
import { JsonCollection } from "../src/adapters/json-collection.ts";
import { Application, Job, type Job as JobRecord, type Application as AppRecord } from "../src/domain.ts";
import { runCommand } from "../src/cli.ts";
import { withTmpDir } from "./helpers.ts";

/** The parser-safe shape the standards note mandates. */
const CLEAN = `# SAMPLE CANDIDATE

Principal Software Engineer — Data Platforms

mayank@example.com · Pune, India

## Summary

Principal engineer, 14 years, ads data platform at 100M+ user consumer apps.

## Experience

Nimbus Data Systems, Pune, India

**Principal Software Engineer**

Jun 2022 – Sep 2026

- Shipped a Go inference service at ~18,000 req/s.

## Education

MBA — Central University, Mumbai
`;

const rules = (md: string, targetCompany?: string) =>
  lintResumeMarkdown(md, { targetCompany: targetCompany ?? null }).map((f) => f.rule);

test("a parser-safe resume produces no format findings", () => {
  assert.deepEqual(rules(CLEAN), []);
});

test("an employer heading with parentheses or a sub-brand is flagged", () => {
  const md = CLEAN.replace(
    "Nimbus Data Systems, Pune, India",
    "### Nimbus Data Systems (NewsRadar · Pulse · DataForge) — Pune",
  );
  assert.ok(rules(md).includes("meta-line-company-decorated"));
});

test("a date range on the employer heading is flagged", () => {
  const md = CLEAN.replace(
    "Nimbus Data Systems, Pune, India",
    "### Nimbus Data Systems, Pune | Jun 2016 – Sep 2026",
  );
  assert.ok(rules(md).includes("meta-line-date-on-heading"));
});

test("two titles joined on one line are flagged", () => {
  const md = CLEAN.replace(
    "**Principal Software Engineer**\n\nJun 2022 – Sep 2026",
    "**Principal Software Engineer** (Jun 2022 – Sep 2026) · **Lead Software Engineer** (Dec 2017 – May 2022)",
  );
  assert.ok(rules(md).includes("meta-line-title-joined"));
});

test("a hyphen instead of an en dash in a date line is flagged", () => {
  const md = CLEAN.replace("Jun 2022 – Sep 2026", "Jun 2022 - Sep 2026");
  assert.ok(rules(md).includes("meta-line-date-malformed"));
});

test("an incomplete date range is flagged as malformed, not as drift", () => {
  const md = CLEAN.replace("Jun 2022 – Sep 2026", "Jun 2022 – Sep 2026 (promoted twice)");
  assert.ok(rules(md).includes("meta-line-date-malformed"));
});

test("bullets that merely mention a year are not flagged as date lines", () => {
  const md = CLEAN.replace(
    "- Shipped a Go inference service at ~18,000 req/s.",
    "- Company hackathon champion, 1st place (Dec 2023): built a RAG system in three days.",
  );
  assert.ok(!rules(md).includes("meta-line-date-malformed"));
});

test("every month of the year is recognised, not just the last alternative", () => {
  // Regression: an ungrouped alternation bound its suffix to `Dec` alone, so
  // `Jun 2022 - Sep 2026` silently passed.
  for (const [month, end] of [["Jun", "Sep"], ["Jan", "Feb"], ["Sep", "Nov"], ["Mar", "Apr"]]) {
    const md = CLEAN.replace("Jun 2022 – Sep 2026", `${month} 2025 - ${end} 2026`);
    assert.ok(rules(md).includes("meta-line-date-malformed"), `${month} should be recognised`);
  }
});

test("the resume naming the target company is flagged", () => {
  const md = CLEAN.replace("Principal Software Engineer — Data Platforms", "Principal Engineer — Walmart Marketplace");
  assert.ok(rules(md, "Walmart").includes("target-company-named"));
});

test("naming an employer the candidate worked for is not flagged", () => {
  const md = CLEAN.replace("- Shipped a Go inference service at ~18,000 req/s.", "- Returned to Nimbus Data Systems to rebuild it.");
  assert.ok(!rules(md, "Nimbus Data Systems").includes("target-company-named"));
});

test("summary and body length are advisory, not blocking", () => {
  const long = CLEAN.replace(
    "Principal engineer, 14 years, ads data platform at 100M+ user consumer apps.",
    "Principal engineer ".repeat(60).trim(),
  );
  const found = rules(long);
  assert.ok(found.includes("summary-too-long"));
  for (const rule of found) {
    if (rule === "summary-too-long" || rule === "resume-too-long") {
      assert.equal(RULES[rule as keyof typeof RULES].severity, "warn");
    }
  }
});

// ---------------------------------------------------------------------------
// employment facts
// ---------------------------------------------------------------------------

test("facts are read from both the plain and the decorated employer form", () => {
  const plain = extractEmploymentFacts(CLEAN);
  const decorated = extractEmploymentFacts(
    CLEAN.replace("Nimbus Data Systems, Pune, India", "### Nimbus Data Systems (NewsRadar) — Bengaluru, India"),
  );
  assert.equal(plain.length, 1);
  assert.deepEqual(
    plain.map((f) => `${f.start}-${f.end}`),
    decorated.map((f) => `${f.start}-${f.end}`),
  );
  assert.equal(plain[0]?.employer, "Nimbus Data Systems");
});

test("the parser-safe plain employer line is recognised, not just headings", () => {
  // Regression: only `###` headings were treated as employers, so the shape the
  // standards note actually mandates was invisible to the fact checker.
  assert.equal(extractEmploymentFacts(CLEAN).length, 1);
});

test("employerName reduces a decorated line to the company", () => {
  assert.equal(employerName("### Nimbus Data Systems (NewsRadar, Josh) - Bengaluru, India"), "Nimbus Data Systems");
  assert.equal(employerName("Nimbus Data Systems, Pune, India"), "Nimbus Data Systems");
  assert.equal(employerName("CognitiveScale, Hyderabad, India (enterprise AI software)"), "CognitiveScale");
});

test("the baseline is the majority verdict, and the dissenter is flagged", () => {
  const agreed = extractEmploymentFacts(CLEAN);
  const drifted = extractEmploymentFacts(CLEAN.replace("Jun 2022 – Sep 2026", "Jun 2022 – Aug 2026"));
  const baseline = baselineFacts([agreed, agreed, agreed, drifted]);
  assert.equal([...baseline.values()][0]?.end, "Sep 2026");
  const found = factDrift(drifted, baseline);
  assert.equal(found.length, 1);
  assert.equal(found[0]?.rule, "fact-drift");
  assert.equal(found[0]?.severity, "error");
});

test("an agreeing variant is not flagged", () => {
  const a = extractEmploymentFacts(CLEAN);
  const b = extractEmploymentFacts(CLEAN.replace("Nimbus Data Systems, Pune, India", "### Nimbus Data Systems, Bengaluru, IN"));
  const baseline = baselineFacts([a, a, b]);
  assert.deepEqual(factDrift(b, baseline), []);
});

// ---------------------------------------------------------------------------
// filenames
// ---------------------------------------------------------------------------

const CANONICAL = ["Candidate_Resume.pdf", "Candidate_CoverLetter.pdf"];

test("the candidate's own filename is accepted", () => {
  assert.deepEqual(lintFilenames(["Candidate_Resume.pdf"], { canonicalFilenames: CANONICAL, targetCompany: "Walmart" }), []);
});

test("a company-named filename is flagged, and named as the target", () => {
  const found = lintFilenames(["Candidate_Resume_Walmart_Marketplace.pdf"], {
    canonicalFilenames: CANONICAL,
    targetCompany: "Walmart",
  });
  assert.deepEqual(found.map((f) => f.rule), ["filename-not-generic", "filename-names-company"]);
});

test("a filename naming a different company is flagged separately", () => {
  const found = lintFilenames(["Candidate_Resume_eBay_AI_Platform.pdf"], {
    canonicalFilenames: CANONICAL,
    targetCompany: "Emirates",
    knownCompanies: ["eBay", "Emirates Group"],
  });
  assert.ok(found.some((f) => f.rule === "filename-names-other-company"));
  assert.ok(!found.some((f) => f.rule === "filename-names-company"));
});

test("local render files are not treated as uploads", () => {
  const found = lintFilenames(["resume.html", "resume-print.html", "resume.md"], {
    canonicalFilenames: CANONICAL,
    targetCompany: "Walmart",
  });
  assert.deepEqual(found, []);
});

test("with no configured filename the generic-name rule degrades instead of false-alarming", () => {
  const found = lintFilenames(["Candidate_Resume_Walmart.pdf"], {
    canonicalFilenames: [],
    targetCompany: "Walmart",
  });
  assert.ok(!found.some((f) => f.rule === "filename-not-generic"));
  assert.ok(found.some((f) => f.rule === "filename-names-company"));
});

test("normalizeCompany ignores legal suffixes", () => {
  assert.equal(normalizeCompany("Acme Inc."), "acme");
  assert.equal(normalizeCompany("Foobar Technologies"), "foobar");
  assert.equal(normalizeCompany("HDFC Bank"), "hdfc bank");
});

test("ownerAppId reads the owning application, or null outside an app dir", () => {
  assert.equal(ownerAppId("applications/app-abc/resume.md"), "app-abc");
  assert.equal(ownerAppId("profile/resume.md"), null);
  assert.equal(ownerAppId(null), null);
});

// ---------------------------------------------------------------------------
// service
// ---------------------------------------------------------------------------

async function seed(root: string) {
  const jobs = new JsonCollection<JobRecord>({ dir: join(root, "jobs"), entityName: "job", validate: (r) => Job.validate(r) });
  const applications = new JsonCollection<AppRecord>({
    dir: join(root, "applications"),
    entityName: "application",
    validate: (r) => Application.validate(r),
  });
  const makeLint = () => new ResumeLintService({ applications, jobs, workspaceRoot: root, canonicalFilenames: CANONICAL });

  const write = async (appId: string, name: string, body: string) => {
    await mkdir(join(root, "applications", appId), { recursive: true });
    await writeFile(join(root, "applications", appId, name), body, "utf8");
  };
  return { jobs, applications, makeLint, write };
}

test("check reports the format findings for a stored resume", async () => {
  await withTmpDir(async (root) => {
    const { jobs, applications, makeLint, write } = await seed(root);
    const job = await jobs.put(Job.create({ company: "Walmart", title: "Principal Engineer", description: "x" }));
    const app = await applications.put(Application.create({ jobId: job.id }));
    await write(app.id, "resume.md", CLEAN.replace("Nimbus Data Systems, Pune, India", "### Nimbus Data Systems (NewsRadar) — Bengaluru"));
    await applications.put({ ...app, artifacts: { ...app.artifacts, resume: `applications/${app.id}/resume.md` } });

    const report = await makeLint().check(app.id);
    assert.equal(report.company, "Walmart");
    assert.ok(errorsIn(report).some((f) => f.rule === "meta-line-company-decorated"));
  });
});

test("check flags an upload named after a different company", async () => {
  await withTmpDir(async (root) => {
    const { jobs, applications, makeLint, write } = await seed(root);
    await jobs.put(Job.create({ company: "eBay", title: "Staff Engineer", description: "x" }));
    const job = await jobs.put(Job.create({ company: "Emirates Group", title: "Principal Engineer", description: "x" }));
    const app = await applications.put(Application.create({ jobId: job.id }));
    await write(app.id, "Candidate_Resume_eBay_AI_Platform.pdf", "pdf");

    const report = await makeLint().check(app.id);
    assert.ok(errorsIn(report).some((f) => f.rule === "filename-names-other-company"));
  });
});

test("check flags an artifact registered against another application's directory", async () => {
  await withTmpDir(async (root) => {
    const { jobs, applications, makeLint } = await seed(root);
    const job = await jobs.put(Job.create({ company: "Acme", title: "Lead", description: "x" }));
    const owner = await applications.put(Application.create({ jobId: job.id }));
    const other = await applications.put(Application.create({ jobId: job.id }));

    await applications.put({
      ...other,
      artifacts: { ...other.artifacts, resume: `applications/${owner.id}/resume.md` },
    });
    const report = await makeLint().check(other.id);
    assert.ok(errorsIn(report).some((f) => f.rule === "artifact-foreign-dir"));
  });
});

test("checkAll covers every application", async () => {
  await withTmpDir(async (root) => {
    const { jobs, applications, makeLint } = await seed(root);
    const job = await jobs.put(Job.create({ company: "Acme", title: "Lead", description: "x" }));
    await applications.put(Application.create({ jobId: job.id }));
    await applications.put(Application.create({ jobId: job.id }));
    assert.equal((await makeLint().checkAll()).length, 2);
  });
});
// ---------------------------------------------------------------------------
// the pre-portal gate
// ---------------------------------------------------------------------------

function collector() {
  const out = { text: "", write: (s: string) => void ((out.text += s)) };
  return out;
}

async function run(argv: string[], root: string) {
  const stdout = collector();
  const stderr = collector();
  const code = await runCommand(argv, { rootDir: root, stdout, stderr });
  return { code, stdout: stdout.text, stderr: stderr.text };
}

const CLEAN_RESUME = `# SAMPLE CANDIDATE

## Summary

Principal engineer, 14 years, ads data platform.

## Experience

Nimbus Data Systems, Pune, India

**Principal Software Engineer**

Jun 2022 – Sep 2026

- Shipped a Go inference service at ~18,000 req/s.
`;

/** An application parked in `tailoring`, ready to move to `ready`. */
async function seedForGate(root: string, resumeBody: string, uploadName = "Candidate_Resume_Walmart.pdf") {
  await run(["init"], root);
  await run(["config", "set", "resumeFilename", "Candidate_Resume.pdf"], root);
  const { loadConfig } = await import("../src/config.ts");
  const { makeServices } = await import("../src/workspace.ts");
  const svc = makeServices(await loadConfig(root));
  const job = await svc.jobs.put(Job.create({ company: "Walmart", title: "Principal Engineer", description: "x" }));
  const app = await svc.applications.put(Application.create({ jobId: job.id }));
  // `init` scaffolds the workspace under <root>/workspace; the lint reads from there.
  const dir = join(root, "workspace", "applications", app.id);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "resume.md"), resumeBody, "utf8");
  if (uploadName) await writeFile(join(dir, uploadName), "pdf", "utf8");
  await svc.applications.put({ ...app, artifacts: { ...app.artifacts, resume: `applications/${app.id}/resume.md` } });
  // Walk the state machine up to `tailoring`; only `ready` is gated.
  for (const to of ["matched", "tailoring"]) {
    const moved = await run(["app", "move", app.id, to], root);
    assert.equal(moved.code, 0, moved.stderr);
  }
  return app.id;
}

test("moving a resume with errors to ready is blocked", async () => {
  await withTmpDir(async (root) => {
    const appId = await seedForGate(root, CLEAN_RESUME);
    const res = await run(["app", "move", appId, "ready"], root);
    assert.equal(res.code, 1);
    assert.match(res.stderr, /blocked:/);
    assert.match(res.stderr, /filename-names-company/);
  });
});

test("--force lets the move through and says what it ignored", async () => {
  await withTmpDir(async (root) => {
    const appId = await seedForGate(root, CLEAN_RESUME);
    const res = await run(["app", "move", appId, "ready", "--force"], root);
    assert.equal(res.code, 0, res.stderr);
    assert.match(res.stderr, /--force/);
    const show = await run(["app", "show", appId], root);
    assert.match(show.stdout, /status=ready/);
  });
});

test("a clean resume moves through the gate without being blocked", async () => {
  await withTmpDir(async (root) => {
    const appId = await seedForGate(root, CLEAN_RESUME, "Candidate_Resume.pdf");
    const res = await run(["app", "move", appId, "ready"], root);
    assert.equal(res.code, 0, res.stderr);
  });
});

test("resume check reports findings and exits non-zero", async () => {
  await withTmpDir(async (root) => {
    const appId = await seedForGate(root, CLEAN_RESUME);
    const res = await run(["resume", "check", appId], root);
    assert.equal(res.code, 1);
    assert.match(res.stdout, /error/);
  });
});
