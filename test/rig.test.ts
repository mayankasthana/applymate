import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { runCommand } from "../src/cli.ts";
import { checkRigServices } from "../src/services/rig.ts";
import { withTmpDir } from "./helpers.ts";

interface Collector {
  text: string;
  write: (s: string) => void;
}

function collector(): Collector {
  const out = { text: "", write: (s: string) => { out.text += s; } };
  return out;
}

async function run(argv: string[], root: string) {
  const stdout = collector();
  const stderr = collector();
  const code = await runCommand(argv, { rootDir: root, stdout, stderr });
  return { code, stdout: stdout.text, stderr: stderr.text };
}

test("rig spec builds a task spec from stored answers into workspace/rig/", async () => {
  await withTmpDir(async (root) => {
    await run(["init"], root);
    assert.equal((await run(["answers", "set", "First name", "Mayank"], root)).code, 0);
    assert.equal((await run(["answers", "set", "Phone number", "5551234567"], root)).code, 0);

    const res = await run(["rig", "spec", "--name", "app-42"], root);
    assert.equal(res.code, 0, res.stderr);
    assert.match(res.stdout, /spec written:/);

    const spec = JSON.parse(await readFile(join(root, "workspace", "rig", "app-42.spec.json"), "utf8"));
    assert.equal(spec.name, "app-42");
    assert.equal(spec.suppress_enter, true);
    assert.deepEqual(spec.field_map, [
      ["first name", "Mayank"],
      ["mobile|phone", "5551234567"],
    ]);
    // stage mode: no success text, DONE gated on the mapped fields instead
    assert.equal(spec.done_when_text, undefined);
    assert.deepEqual(spec.required, [
      { field: "first name", equals: "Mayank" },
      { field: "mobile|phone", equals: "5551234567" },
    ]);
  });
});

test("rig spec --submit requires --success-text", async () => {
  await withTmpDir(async (root) => {
    await run(["init"], root);
    const res = await run(["rig", "spec", "--submit"], root);
    assert.equal(res.code, 1);
    assert.match(res.stderr, /requires successText/);
  });
});

test("rig spec candidateName preference fills the first-name field", async () => {
  await withTmpDir(async (root) => {
    await run(["init"], root);
    await run(["prefs", "set", "candidateName", "Mayank"], root);
    await run(["rig", "spec", "--name", "pref-only", "--out", "spec-out.json"], root);
    const spec = JSON.parse(await readFile(join(root, "spec-out.json"), "utf8"));
    assert.deepEqual(spec.field_map, [["first name", "Mayank"]]);
  });
});

test("checkRigServices reports each service from probe results", async () => {
  const calls: string[] = [];
  const fakeFetch = (async (url: string) => {
    calls.push(url);
    if (url.includes(":9222")) return { ok: true, status: 200, text: async () => '{"Browser":"Chrome"}' };
    throw new Error("connection refused");
  }) as never;
  const checks = await checkRigServices(fakeFetch, { cdp: "http://127.0.0.1:9222", decision: "http://127.0.0.1:8791", spec: "http://127.0.0.1:30000" });
  assert.deepEqual(calls, [
    "http://127.0.0.1:9222/json/version",
    "http://127.0.0.1:8791/",
    "http://127.0.0.1:30000/spec",
  ]);
  assert.deepEqual(checks.map((c) => [c.service, c.ok]), [
    ["chrome-cdp", true],
    ["decision", false],
    ["spec", false],
  ]);
  assert.match(checks.find((c) => c.service === "decision")?.detail ?? "", /connection refused/);
});
