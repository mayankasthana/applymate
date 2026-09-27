import { test } from "node:test";
import assert from "node:assert/strict";
import { homedir } from "node:os";
import { join } from "node:path";

import { expandTilde, resolveFrom } from "../src/paths.ts";

test("expandTilde expands a bare ~ to the home directory", () => {
  assert.equal(expandTilde("~"), homedir());
});

test("expandTilde expands ~-prefixed paths onto home", () => {
  assert.equal(expandTilde("~/docs/dossier"), join(homedir(), "docs/dossier"));
});

test("expandTilde leaves absolute and relative paths untouched", () => {
  assert.equal(expandTilde("/usr/local"), "/usr/local");
  assert.equal(expandTilde("relative/dir"), "relative/dir");
  assert.equal(expandTilde(""), "");
  assert.equal(expandTilde(null), null);
});

test("expandTilde does not expand a mid-path tilde (username dirs)", () => {
  assert.equal(expandTilde("/home/~other/x"), "/home/~other/x");
});

test("resolveFrom resolves a relative path against the base directory", () => {
  assert.equal(resolveFrom("/base", "workspace"), join("/base", "workspace"));
  assert.equal(resolveFrom("/base", "/absolute"), "/absolute");
});
