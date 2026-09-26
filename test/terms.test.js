import { test } from "node:test";
import assert from "node:assert/strict";

import { extractTerms, termCounts, topTerms } from "../src/services/terms.js";

test("extractTerms lowercases, splits, and keeps tech tokens intact", () => {
  const terms = extractTerms("Built services in Go and Kubernetes; also C++ and CI/CD pipelines on node.js.");
  for (const expected of ["go", "kubernetes", "c++", "ci/cd", "node.js"]) {
    assert.ok(terms.includes(expected), `expected ${expected} in ${JSON.stringify(terms)}`);
  }
  assert.ok(!terms.includes("and"));
});

test("extractTerms drops stopwords and single-char tokens, keeps 2-char tech terms", () => {
  const terms = extractTerms("I was on a team of two for the and it API");
  assert.ok(!terms.includes("was"));
  assert.ok(!terms.includes("the"));
  assert.ok(!terms.includes("for"));
  assert.ok(!terms.includes("team"));
  assert.equal(terms.length, 1);
  assert.equal(terms[0], "api");
  assert.deepEqual(extractTerms("go js ai"), ["go", "js", "ai"]);
});

test("extractTerms splits camelCase and dash_case words", () => {
  const terms = extractTerms("KafkaStreams and event_driven design");
  assert.ok(terms.includes("kafkastreams"));
  assert.ok(terms.includes("event"));
  assert.ok(terms.includes("driven"));
});

test("termCounts counts occurrences", () => {
  const counts = termCounts("kafka kafka kafka streams");
  assert.equal(counts.get("kafka"), 3);
  assert.equal(counts.get("streams"), 1);
});

test("topTerms returns most frequent first, respecting minCount", () => {
  const counts = termCounts("go go go rust rust python");
  const top = topTerms(counts, { limit: 10, minCount: 2 });
  assert.deepEqual(top.map((t) => t.term), ["go", "rust"]);
  assert.equal(top[0].count, 3);
});

test("handles empty and null input", () => {
  assert.deepEqual(extractTerms(""), []);
  assert.deepEqual(extractTerms(null), []);
  assert.deepEqual(topTerms(termCounts(""), {}), []);
});
