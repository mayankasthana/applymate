import { test } from "node:test";
import assert from "node:assert/strict";

import { buildLearnReport, renderLearnText, CONFIDENT_SAMPLE } from "../src/services/learn.ts";
import { Application, Job } from "../src/domain.ts";
import type { Application as AppRecord } from "../src/domain.ts";

/** Minimal app record with only the fields the report reads. */
function app(over: Partial<AppRecord> = {}): AppRecord {
  const base = Application.create({ jobId: over.jobId ?? "job-1" }, { now: "2026-01-01T00:00:00.000Z" });
  return { ...base, ...over } as AppRecord;
}

function judged(verdict: "green" | "amber" | "red", matchScore: number | null, over: Partial<AppRecord> = {}): AppRecord {
  return app({
    pursuit: { verdict, note: null, at: "2026-01-01T00:00:00.000Z" },
    matchScore,
    ...over,
  });
}

test("bands report counts, mean, median and range per verdict", () => {
  const apps = [
    judged("green", 80),
    judged("green", 90),
    judged("green", 70),
    judged("amber", 60),
  ];
  const r = buildLearnReport(apps, { now: "2026-01-02T00:00:00.000Z" });
  const green = r.bands.find((b) => b.verdict === "green")!;
  const amber = r.bands.find((b) => b.verdict === "amber")!;
  assert.equal(green.n, 3);
  assert.equal(green.scored, 3);
  assert.equal(green.mean, 80);
  assert.equal(green.median, 80);
  assert.equal(green.min, 70);
  assert.equal(green.max, 90);
  assert.equal(amber.mean, 60);
  assert.equal(r.generatedAt, "2026-01-02T00:00:00.000Z");
});

test("median averages the middle pair on even sample sizes", () => {
  const r = buildLearnReport([judged("green", 70), judged("green", 75)]);
  assert.equal(r.bands.find((b) => b.verdict === "green")!.median, 72.5);
});

test("unscored verdicts are excluded from statistics but counted in coverage", () => {
  const apps = [judged("green", 80), judged("green", null), judged("amber", null)];
  const r = buildLearnReport(apps);
  const green = r.bands.find((b) => b.verdict === "green")!;
  assert.equal(green.n, 2);
  assert.equal(green.scored, 1);
  assert.equal(green.mean, 80);
  assert.equal(r.totals.verdicts, 3);
  assert.equal(r.totals.scoredVerdicts, 1);
});

test("clean separation proposes raising the floor to the lowest green score", () => {
  const apps = [
    ...Array.from({ length: CONFIDENT_SAMPLE }, () => judged("green", 75)),
    judged("green", 90),
    ...Array.from({ length: CONFIDENT_SAMPLE }, () => judged("amber", 50)),
    judged("amber", 60),
  ];
  const r = buildLearnReport(apps, { minMatchScore: 60 });
  assert.deepEqual(r.decisive, { from: 75, to: 60 });
  assert.equal(r.overlap, null);
  const s = r.suggestions.find((x) => x.kind === "raise-floor");
  assert.ok(s, "expected a raise-floor suggestion");
  assert.equal(s!.value, 75);
});

test("a floor above the green floor warns it may be excluding pursued roles", () => {
  const apps = [
    ...Array.from({ length: CONFIDENT_SAMPLE }, () => judged("green", 70)),
    judged("amber", 60),
  ];
  const r = buildLearnReport(apps, { minMatchScore: 80 });
  const s = r.suggestions.find((x) => x.kind === "lower-floor");
  assert.ok(s, "expected a lower-floor suggestion");
  assert.equal(s!.value, 70);
});

test("overlapping score ranges are reported as an overlap, never a floor change", () => {
  // green reaches down into the band non-green also occupies
  const apps = [judged("green", 71), judged("amber", 79)];
  const r = buildLearnReport(apps, { minMatchScore: 60 });
  assert.equal(r.decisive, null);
  assert.deepEqual(r.overlap, { from: 71, to: 79 });
  assert.equal(
    r.suggestions.some((s) => s.kind === "raise-floor" || s.kind === "lower-floor"),
    false,
    "overlapping scores must not move the floor"
  );
  assert.ok(r.suggestions.some((s) => s.kind === "overlap"));
});

test("no scored green means no threshold can be recommended", () => {
  const apps = [judged("amber", 70), judged("red", 40)];
  const r = buildLearnReport(apps);
  assert.equal(r.decisive, null);
  assert.equal(r.overlap, null);
  assert.ok(r.suggestions.some((s) => s.kind === "no-signal"));
  assert.equal(r.suggestions.some((s) => s.kind === "raise-floor" || s.kind === "lower-floor"), false);
});

test("thin samples are flagged and never drive a suggestion", () => {
  const apps = [judged("green", 90), judged("amber", 85)];
  const r = buildLearnReport(apps);
  assert.equal(r.confidence, "low");
  for (const b of r.bands) assert.equal(b.informative, false);
  // separation exists but is not trustworthy, so it must not be acted on
  assert.deepEqual(r.decisive, { from: 90, to: 85 });
  assert.ok(r.suggestions.some((s) => s.kind === "cold"));
  assert.equal(r.suggestions.some((s) => s.kind === "raise-floor" || s.kind === "lower-floor"), false);
});

test("confidence rises with the amount of scored evidence", () => {
  const many = Array.from({ length: CONFIDENT_SAMPLE * 2 }, (_, i) => judged("green", 70 + (i % 5)));
  assert.equal(buildLearnReport(many).confidence, "high");
  assert.equal(buildLearnReport(many.slice(0, CONFIDENT_SAMPLE)).confidence, "medium");
  assert.equal(buildLearnReport(many.slice(0, 3)).confidence, "low");
});

test("sample size is configurable so the gate can be exercised in tests", () => {
  const apps = [judged("green", 90), judged("amber", 85)];
  const r = buildLearnReport(apps, { sampleSize: 1 });
  const scored = r.bands.filter((b) => b.scored > 0);
  assert.equal(scored.length, 2);
  for (const b of scored) assert.equal(b.informative, true);
  // a band with nothing scored can never be informative, whatever the gate
  assert.equal(r.bands.find((b) => b.verdict === "red")!.informative, false);
});

test("outcome funnel counts each rung of the status machine", () => {
  const apps = [
    app({ status: "submitted" }),
    app({ status: "interviewing" }),
    app({ status: "offer" }),
    app({ status: "rejected" }),
    app({ status: "discovered" }),
    app({ status: "closed" }),
  ];
  const f = buildLearnReport(apps).funnel.overall;
  assert.equal(f.submitted, 3); // submitted + interviewing + offer
  assert.equal(f.interviewed, 2); // interviewing + offer
  assert.equal(f.offered, 1);
  assert.equal(f.rejected, 1);
});

test("funnel breaks down by verdict so pursuit predicts conversion", () => {
  const apps = [
    app({ status: "interviewing", pursuit: { verdict: "green", note: null, at: "2026-01-01T00:00:00.000Z" } }),
    app({ status: "rejected", pursuit: { verdict: "red", note: null, at: "2026-01-01T00:00:00.000Z" } }),
  ];
  const { byVerdict } = buildLearnReport(apps).funnel;
  assert.equal(byVerdict.green!.interviewed, 1);
  assert.equal(byVerdict.red!.rejected, 1);
  assert.equal(byVerdict.amber, undefined, "verdicts with no applications are omitted");
});

test("a workspace with no outcomes says so instead of implying calm waters", () => {
  const r = buildLearnReport([judged("green", 80)]);
  assert.equal(r.totals.decided, 0);
  assert.ok(r.suggestions.some((s) => /no application has reached an interview/i.test(s.message)));
});

test("the biggest actionable gap — verdicts with no score — is surfaced first", () => {
  const apps = [judged("green", 80), judged("amber", null), judged("red", null)];
  const r = buildLearnReport(apps, {
    jobs: [Job.create({ id: "job-1", company: "Acme", title: "Staff Eng", description: "d" })],
  });
  assert.equal(r.unscored.count, 2);
  // unscored ids carry the company so the list is actionable
  assert.ok(r.unscored.appIds.some((id) => id.includes("Acme")));
  const first = r.suggestions[0];
  assert.ok(first, "expected at least one suggestion");
  assert.equal(first!.kind, "score-more");
  assert.ok(first!.appIds!.length > 0);
});

test("an empty workspace produces a report instead of throwing", () => {
  const r = buildLearnReport([]);
  assert.equal(r.totals.applications, 0);
  assert.equal(r.confidence, "low");
  assert.equal(r.decisive, null);
  assert.ok(Array.isArray(r.suggestions));
});

test("report rendering states confidence and keeps advisory framing", () => {
  const text = renderLearnText(buildLearnReport([judged("green", 80), judged("amber", 70)], { minMatchScore: 60 }));
  assert.match(text, /confidence: low/);
  assert.match(text, /advisory — nothing changed/);
  assert.match(text, /verdict\s+n\s+scored\s+mean\s+median\s+range/);
});