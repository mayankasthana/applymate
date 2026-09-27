import { test } from "node:test";
import assert from "node:assert/strict";

import { parseArgs } from "../src/args.ts";

test("positional arguments land in _", () => {
  const { _, flags } = parseArgs(["job", "add", "extra"]);
  assert.deepEqual(_, ["job", "add", "extra"]);
  assert.deepEqual(flags, {});
});

test("--key value, --key=value and bare --flag forms all parse", () => {
  const { flags } = parseArgs(["--company", "Acme", "--title=CEO", "--draft", "--age", "42"]);
  assert.equal(flags.company, "Acme");
  assert.equal(flags.title, "CEO");
  assert.equal(flags.draft, true);
  assert.equal(flags.age, "42");
});

test("value may be empty via --key=", () => {
  const { flags } = parseArgs(["--note="]);
  assert.equal(flags.note, "");
});

test("double-dash stops flag parsing (rest is positional)", () => {
  const { _, flags } = parseArgs(["chat", "send", "--", "--looks-like-flag"]);
  assert.deepEqual(_, ["chat", "send", "--looks-like-flag"]);
  assert.deepEqual(flags, {});
});
