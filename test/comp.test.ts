import { test } from "node:test";
import assert from "node:assert/strict";

import {
  annualized,
  compareToFloor,
  compMidpoint,
  describeComp,
  formatAmount,
  formatCompensation,
  formatIndian,
  normalizeComp,
  parseCompensations,
  parseFloor,
  recordFromCandidate,
  type Compensation,
} from "../src/services/comp.ts";

/** The single figure the first candidate would become. */
function first(text: string) {
  const hit = parseCompensations(text)[0];
  assert.ok(hit, `expected a figure in: ${text}`);
  return hit!;
}

function none(text: string) {
  assert.deepEqual(parseCompensations(text), [], `expected no figure in: ${text}`);
}

test("reads a currency-marked range in the shapes postings use", () => {
  assert.deepEqual(
    { ...first("Base salary: $140K - $210K"), at: 0 },
    { low: 140_000, high: 210_000, currency: "USD", period: "year", asText: "$140K - $210K", at: 0 }
  );
  assert.deepEqual({ ...first("the range is €93,280.00 – €139,920.00 per year"), at: 0 }, {
    low: 93_280, high: 139_920, currency: "EUR", period: "year", asText: "€93,280.00 – €139,920.00", at: 0,
  });
  assert.deepEqual({ ...first("USD 120,000 to USD 150,000"), at: 0 }, {
    low: 120_000, high: 150_000, currency: "USD", period: "year", asText: "USD 120,000 to USD 150,000", at: 0,
  });
});

test("European dot grouping is thousands, not a decimal point", () => {
  const hit = first("The annual compensation range for this role is €235.000 - €295.000 EUR");
  assert.equal(hit.currency, "EUR");
  assert.deepEqual([hit.low, hit.high], [235_000, 295_000]);
});

test("Indian grouping and lakh/crore magnitudes resolve to rupees", () => {
  const ctc = first("Annual CTC 40,00,000 for this role");
  assert.deepEqual([ctc.currency, ctc.low, ctc.high], ["INR", 4_000_000, 4_000_000]);

  const lpa = first("compensation of 60 LPA");
  assert.deepEqual([lpa.currency, lpa.low], ["INR", 6_000_000]);

  const range = first("₹25L to ₹55L");
  assert.deepEqual([range.low, range.high], [2_500_000, 5_500_000]);
});

test("the period follows the wording, and annualizes for comparison", () => {
  const hourly = recordFromCandidate(first("pay is $60 - $75 per hour"), { basis: "posted" })!;
  assert.equal(hourly.period, "hour");
  assert.deepEqual(annualized(hourly), { low: 124_800, high: 156_000 });

  const monthly = recordFromCandidate(first("₹30,00,000 per month"), { basis: "posted" })!;
  assert.equal(monthly.period, "month");
  assert.equal(annualized(monthly).high, 36_000_000);
});

test("figures that are not pay are never read as pay", () => {
  none("We raised $50M Series B and employ 400 people");
  none("generated total revenues of EUR 6.95 billion last year");
  none("With $300B+ under administration and 700,000 LPs on platform");
  none("Job Ref: R2627213 Legal Notice Accessibility Statement");
  none("a one-time $500 (USD) stipend for desk setup");
  none("€5k referral bonus for every successful hire");
  none("bonus of 15% of base salary");
  none("You led the team from 2019 - 2025");
  none("We are looking for 5000 employees across 40 offices");
  none("Multi-tier Cloud Platforms: AWS (EC2, Lambda), Databases: PostgreSQL");
  none("30K–50K monthly salary"); // real money, but no currency to attribute it to
  none("");
  none("   ");
});

test("every candidate carries the text it came from", () => {
  const hit = first("Compensation: $140K - $210K base");
  assert.equal(hit.asText, "$140K - $210K");
  assert.equal(hit.at, 14);
});

test("a listing whose text states several bands returns all of them", () => {
  // A YC-board posting lists this role plus "other jobs at <company>"; the
  // agent must be able to see every band before choosing one.
  const all = parseCompensations(
    "Software Engineer (India) at Strac ₹2.5M - ₹5M INR. Other jobs: Sales Development Representative $60K - $65K."
  );
  assert.deepEqual(all.map((c) => c.currency), ["INR", "USD"]);
});

test("a stored figure is only valid with a currency and, when scraped, a citation", () => {
  const ok = { low: 100, high: 200, currency: "usd", basis: "posted", asText: "$100-200" };
  const comp = normalizeComp(ok)!;
  assert.equal(comp.currency, "USD");
  assert.equal(comp.period, "year");

  assert.equal(normalizeComp({ ...ok, high: 50 }), null, "an inverted range is not a band");
  assert.equal(normalizeComp({ ...ok, low: 0 }), null);
  assert.equal(normalizeComp({ ...ok, currency: "dollars" }), null);
  assert.equal(normalizeComp({ ...ok, basis: "sourced" }), null, "a scraped figure with no source URL is a guess");
  assert.equal(normalizeComp({ ...ok, basis: "sourced", sourceUrl: "https://example.com/x" })!.sourceUrl, "https://example.com/x");
  assert.equal(normalizeComp(null), null);
});

test("a figure a person stated is attributable by name, and has no URL", () => {
  const anchor = {
    low: 6_000_000,
    high: 6_000_000,
    currency: "INR",
    basis: "stated" as const,
    asText: "60 LPA",
  };
  assert.equal(
    normalizeComp(anchor),
    null,
    "a number someone said on a call is not a fact about the job until you can say who said it"
  );
  const said = normalizeComp({ ...anchor, sourceName: "Neha Badola (Careernet), verbal on a call" })!;
  assert.equal(said.sourceName, "Neha Badola (Careernet), verbal on a call");
  assert.equal(said.sourceUrl, null, "citing a careers page for a phone-call figure would fabricate its provenance");
  assert.match(describeComp(said), /stated by Neha Badola/, "the card must not present this as scraped from a page");
});

test("figures are formatted in the reader's own notation", () => {
  const show = (c: Partial<Compensation>) =>
    formatCompensation(normalizeComp({ low: 0, high: 0, currency: "USD", basis: "posted", ...c })!);

  assert.equal(show({ low: 140_000, high: 210_000 }), "$140–210K");
  assert.equal(show({ low: 132_000, high: 132_000, currency: "EUR" }), "€132K");
  assert.equal(show({ low: 4_000_000, high: 5_500_000, currency: "INR" }), "₹40–55L");
  assert.equal(show({ low: 12_000_000, high: 12_000_000, currency: "INR" }), "₹1.2Cr");
  assert.equal(show({ low: 46_172, high: 57_715 }), "$46.2–57.7K");
  assert.equal(show({ low: 45, high: 75, period: "hour" }), "$45–75/hr");
  // Endpoints in different magnitudes keep their own unit rather than collapsing.
  assert.equal(show({ low: 400_000, high: 90_000_000, currency: "INR" }), "₹4L–₹9Cr");
  assert.equal(formatAmount(4_500_000, "INR"), "₹45L");
  assert.equal(formatIndian(4_500_000), "45,00,000");
});

test("the description says where the figure came from", () => {
  const posted = recordFromCandidate(first("base salary $140K - $210K"), { basis: "posted", now: "2026-10-03T00:00:00.000Z" })!;
  assert.match(describeComp(posted), /stated in the posting \(recorded 2026-10-03\)/);

  const scraped = recordFromCandidate(first("base salary $140K - $210K"), {
    basis: "sourced",
    sourceName: "Example careers page",
    sourceUrl: "https://example.com/jobs/1",
    now: "2026-10-03T00:00:00.000Z",
  })!;
  assert.match(describeComp(scraped), /scraped from Example careers page/);
  assert.equal(compMidpoint(scraped), 175_000);
});

test("the candidate's floor is read from their own preference, or not at all", () => {
  assert.deepEqual(parseFloor("60 LPA (INR)"), { amount: 6_000_000, currency: "INR", asText: "60 LPA (INR)" });
  assert.deepEqual(parseFloor("$150k"), { amount: 150_000, currency: "USD", asText: "$150k" });
  assert.equal(parseFloor("negotiable"), null);
  assert.equal(parseFloor(""), null);
  assert.equal(parseFloor(undefined), null);
});

test("a figure is compared to the floor only in its own currency", () => {
  const inr = normalizeComp({ low: 5_000_000, high: 6_000_000, currency: "INR", basis: "posted" })!;
  const usd = normalizeComp({ low: 200_000, high: 260_000, currency: "USD", basis: "posted" })!;
  const floor = parseFloor("60 LPA (INR)")!;

  assert.equal(compareToFloor(inr, floor), "at-or-above");
  assert.equal(compareToFloor(normalizeComp({ low: 3_000_000, high: 4_000_000, currency: "INR", basis: "posted" })!, floor), "below");
  assert.equal(compareToFloor(usd, floor), "unknown", "rupees are never ranked against dollars without a rate");
  assert.equal(compareToFloor(inr, null), "no-floor");
});