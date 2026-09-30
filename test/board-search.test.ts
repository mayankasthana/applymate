import { test } from "node:test";
import assert from "node:assert/strict";

import { filterBoard, type Board } from "../src/services/board-search.ts";
import type { AppSummary } from "../src/services/pipeline.ts";
import { STATUSES, type Status } from "../src/domain.ts";

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
    jobUrl: null,
    ...overrides,
  };
}

function board(cards: AppSummary[]): Board {
  const out = {} as Record<Status, AppSummary[]>;
  for (const s of STATUSES) out[s] = [];
  for (const c of cards) out[c.status]!.push(c);
  return out;
}

const SAMPLE: AppSummary[] = [
  card({
    id: "app-adtech",
    jobId: "job-adtech",
    company: "Example Retail Co",
    title: "Staff Software Engineer — Advertising & Marketing Technology",
    jobUrl: "https://walmart.example/job/STAFF--SOFTWARE-ENGINEER_R-2646399",
  }),
  card({
    id: "app-data",
    company: "InMobi",
    title: "Staff Engineer I",
    matchScore: 84,
    pursuit: { verdict: "green", note: "agentic commerce platform, RTB background fits", at: "2026-09-29" },
  }),
  card({
    id: "app-junior",
    company: "SmallCo",
    title: "Software Engineer III",
    matchScore: 41,
    status: "closed",
  }),
];

test("empty or whitespace query returns the board unchanged", () => {
  const b = board(SAMPLE);
  assert.deepEqual(filterBoard(b, ""), b);
  assert.deepEqual(filterBoard(b, "   "), b);
  assert.deepEqual(filterBoard(b, null), b);
});

test("req id pasted by the candidate matches through the posting URL", () => {
  const out = filterBoard(board(SAMPLE), "R-2646399");
  assert.deepEqual(ids(out), ["app-adtech"]);
});

test("company name and free terms match case-insensitively", () => {
  assert.deepEqual(ids(filterBoard(board(SAMPLE), "inmobi")), ["app-data"]);
  assert.deepEqual(ids(filterBoard(board(SAMPLE), "advertising")), ["app-adtech"]);
});

test("a term matches the pursuit verdict note too", () => {
  assert.deepEqual(ids(filterBoard(board(SAMPLE), "agentic")), ["app-data"]);
});

test("multiple tokens AND together (company + level)", () => {
  assert.deepEqual(ids(filterBoard(board(SAMPLE), "walmart staff")), ["app-adtech"]);
  assert.deepEqual(ids(filterBoard(board(SAMPLE), "inmobi staff")), ["app-data"]);
  // AND means a token that only fits another card kills the match
  assert.deepEqual(ids(filterBoard(board(SAMPLE), "inmobi walmart")), []);
});

test("match score digits and application id are searchable", () => {
  assert.deepEqual(ids(filterBoard(board(SAMPLE), "84")), ["app-data"]);
  assert.deepEqual(ids(filterBoard(board(SAMPLE), "app-adtech")), ["app-adtech"]);
});

test("columns with no matches come back empty, others keep their cards", () => {
  const out = filterBoard(board(SAMPLE), "staff");
  assert.equal(out.discovered!.length, 2);
  assert.equal(out.closed!.length, 0);
});

function ids(b: Board): string[] {
  return STATUSES.flatMap((s) => (b[s] ?? []).map((a) => a.id));
}
