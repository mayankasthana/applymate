import { test } from "node:test";
import assert from "node:assert/strict";

import { countBoard, parseBoardView, viewBoard, type BoardView } from "../src/services/board-view.ts";
import type { Board } from "../src/services/board-search.ts";
import type { AppSummary } from "../src/services/pipeline.ts";
import { normalizeCompensation, STATUSES, type Status } from "../src/domain.ts";

function card(overrides: Partial<AppSummary>): AppSummary {
  return {
    id: "app-1",
    jobId: "job-1",
    company: "Acme",
    title: "Staff Software Engineer",
    status: "discovered",
    matchScore: 74,
    pursuit: null,
    resumeRef: null,
    updatedAt: "2026-09-30T00:00:00.000Z",
    lastMovedAt: "2026-09-30T00:00:00.000Z",
    jobUrl: null,
    location: null,
    comp: null,
    ...overrides,
  };
}

function board(cards: AppSummary[]): Board {
  const out = {} as Record<Status, AppSummary[]>;
  for (const s of STATUSES) out[s] = [];
  for (const c of cards) out[c.status]!.push(c);
  return out;
}

function pay(low: number, high: number, currency = "INR", period: "year" | "month" | "hour" = "year") {
  return normalizeCompensation({ low, high, currency, period, basis: "posted", asText: `${low}-${high} ${currency}` })!;
}

const SAMPLE: AppSummary[] = [
  card({ id: "app-acme", company: "Acme", matchScore: 91, updatedAt: "2026-09-28T00:00:00.000Z", comp: pay(7_000_000, 9_000_000) }),
  card({
    id: "app-beta",
    company: "Beta Corp",
    matchScore: 62,
    updatedAt: "2026-09-30T00:00:00.000Z",
    pursuit: { verdict: "green", note: null, at: "2026-09-30" },
    comp: pay(3_000_000, 4_000_000),
  }),
  card({ id: "app-gamma", company: "Gamma", matchScore: null, updatedAt: "2026-09-29T00:00:00.000Z", pursuit: { verdict: "red", note: "pedigree gate", at: "2026-09-29" } }),
  card({ id: "app-delta", company: "Delta", matchScore: 78, status: "closed", updatedAt: "2026-09-20T00:00:00.000Z", comp: pay(200_000, 260_000, "USD") }),
];

const ids = (b: Board) => STATUSES.flatMap((s) => (b[s] ?? []).map((a) => a.id));

test("no view returns every card, ordered by recency as before", () => {
  assert.deepEqual(ids(viewBoard(board(SAMPLE))), ["app-beta", "app-gamma", "app-acme", "app-delta"]);
  assert.equal(countBoard(viewBoard(board(SAMPLE))), 4);
});

test("a minimum score keeps the cards that clear it and drops the unscored", () => {
  assert.deepEqual(ids(viewBoard(board(SAMPLE), { minScore: 80 })), ["app-acme"]);
  assert.deepEqual(ids(viewBoard(board(SAMPLE), { minScore: 60 })), ["app-beta", "app-acme", "app-delta"]);
  assert.deepEqual(ids(viewBoard(board(SAMPLE), { minScore: 0 })), ["app-beta", "app-gamma", "app-acme", "app-delta"]);
});

test("the pursuit filter selects a verdict, or the cards that have none", () => {
  assert.deepEqual(ids(viewBoard(board(SAMPLE), { pursuit: "green" })), ["app-beta"]);
  assert.deepEqual(ids(viewBoard(board(SAMPLE), { pursuit: "red" })), ["app-gamma"]);
  assert.deepEqual(ids(viewBoard(board(SAMPLE), { pursuit: "none" })), ["app-acme", "app-delta"]);
});

test("stages keep only the lanes the candidate named", () => {
  assert.deepEqual(ids(viewBoard(board(SAMPLE), { stages: ["discovered"] })), ["app-beta", "app-gamma", "app-acme"]);
  assert.deepEqual(ids(viewBoard(board(SAMPLE), { stages: ["closed"] })), ["app-delta"]);
  assert.deepEqual(ids(viewBoard(board(SAMPLE), { stages: [] })), ids(viewBoard(board(SAMPLE))), "no lanes named means all of them");
});

test("filters combine, and all of them must pass", () => {
  assert.deepEqual(ids(viewBoard(board(SAMPLE), { minScore: 60, pursuit: "green" })), ["app-beta"]);
  assert.deepEqual(ids(viewBoard(board(SAMPLE), { minScore: 60, stages: ["closed"] })), ["app-delta"]);
  assert.deepEqual(ids(viewBoard(board(SAMPLE), { query: "beta", minScore: 90 })), []);
});

test("the search box still applies alongside the filters", () => {
  assert.deepEqual(ids(viewBoard(board(SAMPLE), { query: "R-2646399" })), []);
  assert.deepEqual(ids(viewBoard(board(SAMPLE), { query: "gamma" })), ["app-gamma"]);
});

test("pay filters split listings with a figure from those without", () => {
  assert.deepEqual(ids(viewBoard(board(SAMPLE), { pay: "with" })), ["app-beta", "app-acme", "app-delta"]);
  assert.deepEqual(ids(viewBoard(board(SAMPLE), { pay: "without" })), ["app-gamma"]);
  assert.deepEqual(ids(viewBoard(board(SAMPLE), { pay: "any" })), ids(viewBoard(board(SAMPLE))));
});

test("below-floor compares only within the candidate's own currency", () => {
  const floor = { amount: 6_000_000, currency: "INR", asText: "60 LPA" };
  assert.deepEqual(ids(viewBoard(board(SAMPLE), { pay: "below-floor", floor })), ["app-beta"]);
  // The dollar card is above the INR floor in its own terms, but the two are
  // never ranked against each other, so it is not called "above" or "below".
  assert.deepEqual(ids(viewBoard(board(SAMPLE), { pay: "below-floor", floor: null })), []);
});

test("sorts order the cards inside a lane", () => {
  const mixed = board([
    card({ id: "app-c", company: "Charlie", matchScore: 55, updatedAt: "2026-09-30T00:00:00.000Z" }),
    card({ id: "app-a", company: "Alpha", matchScore: 88, updatedAt: "2026-09-29T00:00:00.000Z" }),
    card({ id: "app-b", company: "Bravo", matchScore: 70, updatedAt: "2026-09-30T12:00:00.000Z" }),
  ]);
  assert.deepEqual(ids(viewBoard(mixed, { sort: "recent" })), ["app-b", "app-c", "app-a"]);
  assert.deepEqual(ids(viewBoard(mixed, { sort: "score" })), ["app-a", "app-b", "app-c"]);
  assert.deepEqual(ids(viewBoard(mixed, { sort: "company" })), ["app-a", "app-b", "app-c"]);
});

test("an unscored card sorts last under score, never first", () => {
  const b = board([
    card({ id: "app-unknown", matchScore: null }),
    card({ id: "app-low", matchScore: 41 }),
    card({ id: "app-high", matchScore: 90 }),
  ]);
  assert.deepEqual(ids(viewBoard(b, { sort: "score" })), ["app-high", "app-low", "app-unknown"]);
});

test("pay sorts by annualized midpoint within a currency, and never across one", () => {
  const b = board([
    card({ id: "app-inr-low", comp: pay(3_000_000, 4_000_000) }),
    card({ id: "app-inr-high", comp: pay(8_000_000, 9_000_000) }),
    card({ id: "app-inr-monthly", comp: pay(300_000, 400_000, "INR", "month") }),
    card({ id: "app-usd", comp: pay(200_000, 260_000, "USD") }),
    card({ id: "app-none", comp: null }),
  ]);
  // INR first (alphabetical), highest annualized midpoint first inside it:
  // the monthly band annualizes to 3.6-4.8M, so it leads the yearly 3-4M one.
  assert.deepEqual(ids(viewBoard(b, { sort: "pay" })), [
    "app-inr-high",
    "app-inr-monthly",
    "app-inr-low",
    "app-usd",
    "app-none",
  ]);
});

test("a sort is stable and total: equal cards fall back to the id", () => {
  const b = board([
    card({ id: "app-2", company: "Same", matchScore: 70 }),
    card({ id: "app-1", company: "Same", matchScore: 70 }),
  ]);
  assert.deepEqual(ids(viewBoard(b, { sort: "score" })), ["app-1", "app-2"]);
});

test("query parameters become a view, and junk ones narrow nothing", () => {
  const view = parseBoardView(
    new URLSearchParams("q=staff&minScore=70&pursuit=green&status=ready,submitted&pay=with&sort=pay")
  );
  assert.deepEqual(view, {
    query: "staff",
    minScore: 70,
    pursuit: "green",
    stages: ["ready", "submitted"],
    pay: "with",
    sort: "pay",
  });

  const junk = parseBoardView(new URLSearchParams("minScore=900&pursuit=purple&pay=maybe&sort=sideways&status="));
  assert.equal(junk.minScore, 100, "an out-of-range score clamps instead of failing");
  assert.equal(junk.pursuit, null);
  assert.equal(junk.pay, null);
  assert.equal(junk.sort, null);
  assert.equal(junk.stages, null);

  const empty = parseBoardView(new URLSearchParams(""));
  assert.deepEqual(ids(viewBoard(board(SAMPLE), empty)), ids(viewBoard(board(SAMPLE))));
});

test("every lane stays present even when a filter empties it", () => {
  const out = viewBoard(board(SAMPLE), { minScore: 99 });
  assert.deepEqual(Object.keys(out).sort(), [...STATUSES].sort());
  assert.equal(countBoard(out), 0);
});

test("an empty view object leaves the board exactly as it was", () => {
  const b = board(SAMPLE);
  const view: BoardView = {};
  assert.deepEqual(viewBoard(b, view), viewBoard(b));
});