import { test } from "node:test";
import assert from "node:assert/strict";

import { slugify, makeId, shortCode } from "../src/ids.js";

test("slugify lowercases, strips punctuation, and joins with dashes", () => {
  assert.equal(slugify("Senior Backend Engineer"), "senior-backend-engineer");
  assert.equal(slugify("  Acme Corp. (Remote) — Staff SRE! "), "acme-corp-remote-staff-sre");
  assert.equal(slugify("C++ / Systems"), "c-systems");
});

test("slugify collapses runs of non-alphanumerics into one dash", () => {
  assert.equal(slugify("a -- b___c"), "a-b-c");
});

test("slugify caps length and trims trailing dashes", () => {
  const s = slugify("x".repeat(100));
  assert.ok(s.length <= 48, `expected <=48, got ${s.length}`);
  assert.ok(!s.endsWith("-"));
});

test("shortCode is 4 lowercase alphanumeric chars", () => {
  for (let i = 0; i < 50; i++) {
    assert.match(shortCode(), /^[a-z0-9]{4}$/);
  }
});

test("makeId prefixes slug and code", () => {
  const id = makeId("job", "Acme Corp — Senior Engineer");
  assert.match(id, /^job-acme-corp-senior-engineer-[a-z0-9]{4}$/);
});

test("makeId handles empty text", () => {
  const id = makeId("app", "");
  assert.match(id, /^app-[a-z0-9]{4}$/);
});

test("makeId is unique across calls with identical input", () => {
  const a = makeId("job", "acme");
  const b = makeId("job", "acme");
  assert.notEqual(a, b);
});
