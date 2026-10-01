import { test } from "node:test";
import assert from "node:assert/strict";

import { buildFormSpec, DEFAULT_SUPPRESS_CLICK, FORM_FIELD_CATEGORIES } from "../src/form-spec.ts";

const ANSWERS = [
  { question: "First name", answer: "Alex" },
  { question: "Last name", answer: "Rivers" },
  { question: "What email should employers use?", answer: "aja@example.com" },
  { question: "Mobile number", answer: "5551234567" },
  { question: "Current address", answer: "1 Test Way, Testville" },
  { question: "Have you used Kubernetes?", answer: "yes" }, // unknown category: must be ignored
];

test("buildFormSpec maps stored answers onto page field labels", () => {
  const spec = buildFormSpec({ name: "app-1", answers: ANSWERS });
  const mapped = Object.fromEntries(spec.field_map);
  assert.equal(mapped["first name"], "Alex");
  assert.equal(mapped["last name"], "Rivers");
  assert.equal(mapped["mobile|phone"], "5551234567");
  assert.equal(mapped["user email|example\\.com|e-?mail"], "aja@example.com");
  // every mapped field gates DONE in stage mode
  assert.equal(spec.required.length, spec.field_map.length);
  assert.deepEqual(spec.required[0], { field: "first name", equals: "Alex" });
});

test("buildFormSpec never invents values: unmatched categories are omitted", () => {
  const spec = buildFormSpec({ name: "app-1", answers: [{ question: "First name", answer: "Alex" }] });
  assert.equal(spec.field_map.length, 1);
  assert.equal(spec.required.length, 1);
});

test("candidateName fills the first-name field when no stored answer exists", () => {
  const spec = buildFormSpec({ name: "app-1", answers: [], candidateName: "Alex" });
  assert.deepEqual(spec.field_map, [["first name", "Alex"]]);
  // ...but a stored answer wins over the preference
  const explicit = buildFormSpec({ name: "app-1", answers: ANSWERS, candidateName: "Other" });
  assert.deepEqual(explicit.field_map[0], ["first name", "Alex"]);
});

test("stage mode gates DONE on filled fields and suppresses Enter; no success text", () => {
  const spec = buildFormSpec({ name: "app-1", answers: ANSWERS });
  assert.equal(spec.suppress_enter, true);
  assert.equal(spec.done_when_text, undefined);
});

test("submit mode requires success text and gates DONE on it", () => {
  const spec = buildFormSpec({ name: "app-1", answers: ANSWERS, mode: "submit", successText: "Thanks for submitting" });
  assert.equal(spec.done_when_text, "Thanks for submitting");
  assert.throws(() => buildFormSpec({ name: "app-1", answers: ANSWERS, mode: "submit" }),
    /requires successText/);
});

test("suppress_click merges defaults with caller extras", () => {
  const spec = buildFormSpec({ name: "app-1", answers: ANSWERS, suppressClick: ["^Form$"] });
  assert.deepEqual(spec.suppress_click, [...DEFAULT_SUPPRESS_CLICK, "^Form$"]);
});

test("every category's field label is Python-re-safe (no backticks/quotes)", () => {
  for (const c of FORM_FIELD_CATEGORIES) {
    assert.doesNotMatch(c.field, /["'`]/);
  }
});
