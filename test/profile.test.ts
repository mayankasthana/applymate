import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { ProfileStore, RECOMMENDED_PREFERENCE_KEYS, RECOMMENDED_NOTE_NAMES } from "../src/services/profile.ts";
import { runCommand } from "../src/cli.ts";
import { withTmpDir } from "./helpers.ts";

const makeProfile = (root: string) => new ProfileStore({ dir: root });

/** CLI driver for the note tests, mirroring the other suites. */
async function helpers(root: string) {
  const call = async (argv: string[]) => {
    let out = "";
    let err = "";
    const code = await runCommand(argv, {
      rootDir: root,
      stdout: { write: (s: string) => { out += s; } },
      stderr: { write: (s: string) => { err += s; } },
    });
    return { code, stdout: out, stderr: err };
  };
  await call(["init"]);
  await writeFile(join(root, "src.md"), "MUST-READ RULES\n", "utf8");
  return { run: call };
}

test("preferences: set/get/list roundtrip and persist across instances", async () => {
  await withTmpDir(async (root) => {
    const p = makeProfile(root);
    await p.setPreference("companyType", "product-based", { source: "chat" });
    await p.setPreference("salaryFloor", 150000);
    const fresh = makeProfile(root);
    const record = await fresh.getPreference("companyType");
    assert.equal(record!.value, "product-based");
    assert.equal(record!.source, "chat");
    assert.equal((await fresh.getPreference("salaryFloor"))!.value, 150000);
    assert.equal((await fresh.preferences()).length, 2);
  });
});

test("preferences: keys are normalized (case/whitespace)", async () => {
  await withTmpDir(async (root) => {
    const p = makeProfile(root);
    await p.setPreference("  Company Type ", "product");
    assert.equal((await p.getPreference("companytype"))!.value, "product");
    assert.ok((await p.missingPreferences()).includes("companyType") === false);
  });
});

test("prefs missing lists recommended keys that have no value", async () => {
  await withTmpDir(async (root) => {
    const p = makeProfile(root);
    assert.deepEqual(await p.missingPreferences(), [...RECOMMENDED_PREFERENCE_KEYS]);
    await p.setPreference("companyType", "product-based");
    const missing = await p.missingPreferences();
    assert.ok(!missing.includes("companyType"));
    assert.equal(missing.length, RECOMMENDED_PREFERENCE_KEYS.length - 1);
  });
});

test("setPreference rejects empty keys", async () => {
  await withTmpDir(async (root) => {
    const p = makeProfile(root);
    await assert.rejects(() => p.setPreference("   ", "x"), /key/i);
  });
});

test("answers: record then exact-recall (case/punctuation-insensitive)", async () => {
  await withTmpDir(async (root) => {
    const p = makeProfile(root);
    await p.recordAnswer("Are you authorized to work in the US?", "Yes, no sponsorship needed");
    const found = await p.findAnswer("are you authorized to work in the us?");
    assert.equal(found!.answer, "Yes, no sponsorship needed");
    assert.ok(found!.updatedAt);
  });
});

test("answers: fuzzy recall matches a reworded question above threshold", async () => {
  await withTmpDir(async (root) => {
    const p = makeProfile(root);
    await p.recordAnswer("How many years of experience do you have with Kubernetes?", "6 years");
    const found = await p.findAnswer("years of experience with Kubernetes");
    assert.equal(found!.answer, "6 years");
  });
});

test("answers: unrelated questions return null", async () => {
  await withTmpDir(async (root) => {
    const p = makeProfile(root);
    await p.recordAnswer("How many years of experience do you have with Kubernetes?", "6 years");
    assert.equal(await p.findAnswer("What is your greatest weakness?"), null);
    assert.equal(await p.findAnswer(""), null);
  });
});

test("answers: re-recording a question updates the answer in place", async () => {
  await withTmpDir(async (root) => {
    const p = makeProfile(root);
    await p.recordAnswer("Willing to relocate?", "No");
    await p.recordAnswer("Willing to relocate?", "Yes, for the right company");
    const all = await p.answers();
    assert.equal(all.length, 1);
    assert.equal(all[0]!.answer, "Yes, for the right company");
  });
});

test("answers: list returns everything for the browser-apply protocol", async () => {
  await withTmpDir(async (root) => {
    const p = makeProfile(root);
    await p.recordAnswer("First name", "Priya");
    await p.recordAnswer("Years of experience", "12");
    const all = await p.answers();
    assert.equal(all.length, 2);
  });
});

test("answers: rejects empty question or answer", async () => {
  await withTmpDir(async (root) => {
    const p = makeProfile(root);
    await assert.rejects(() => p.recordAnswer("  ", "a"), /question/i);
    await assert.rejects(() => p.recordAnswer("q", ""), /answer/i);
  });
});

// -- notes --------------------------------------------------------------------

test("notes are stored, read back, and listed by name", async () => {
  await withTmpDir(async (root) => {
    const { run } = await helpers(root);
    assert.equal((await run(["profile", "note", "set", "resume-standards", "src.md"])).code, 0);
    const got = await run(["profile", "note", "get", "resume-standards"]);
    assert.match(got.stdout, /MUST-READ/);
    const list = await run(["profile", "note", "list"]);
    assert.match(list.stdout, /resume-standards/);
  });
});

test("note names keep their dashes rather than collapsing", async () => {
  await withTmpDir(async (root) => {
    const { run } = await helpers(root);
    await run(["profile", "note", "set", "resume-standards", "src.md"]);
    const list = await run(["profile", "note", "list"]);
    assert.match(list.stdout, /resume-standards/);
    assert.doesNotMatch(list.stdout, /resumestandards/);
  });
});

test("missing notes are reported, and stop being reported once set", async () => {
  await withTmpDir(async (root) => {
    const { run } = await helpers(root);
    const before = await run(["profile", "note", "missing"]);
    assert.match(before.stdout, /resume-standards/);
    await run(["profile", "note", "set", "resume-standards", "src.md"]);
    const after = await run(["profile", "note", "missing"]);
    assert.match(after.stdout, /all recommended notes are present/);
  });
});

test("a note round-trips through export, so the gitignored copy is backed up somewhere", async () => {
  await withTmpDir(async (root) => {
    const { run } = await helpers(root);
    await run(["profile", "note", "set", "resume-standards", "src.md"]);
    assert.equal((await run(["profile", "note", "export", "resume-standards", "backup.md"])).code, 0);
    const exported = await readFile(join(root, "backup.md"), "utf8");
    assert.match(exported, /MUST-READ/);
  });
});

test("init seeds the starter note but never clobbers a filled one", async () => {
  await withTmpDir(async (root) => {
    const { run } = await helpers(root);
    // the template the repo ships
    await mkdir(join(root, "templates"), { recursive: true });
    await writeFile(join(root, "templates", "resume-standards.md"), "TEMPLATE MARKER\n");

    await run(["init"]);
    const seeded = await run(["profile", "note", "get", "resume-standards"]);
    assert.match(seeded.stdout, /TEMPLATE MARKER/);

    // the candidate fills it in
    await writeFile(join(root, "filled.md"), "MY OWN RULES\n");
    await run(["profile", "note", "set", "resume-standards", "filled.md"]);
    // re-running init must not undo that
    await run(["init"]);
    const after = await run(["profile", "note", "get", "resume-standards"]);
    assert.match(after.stdout, /MY OWN RULES/);
    assert.doesNotMatch(after.stdout, /TEMPLATE MARKER/);
  });
});

test("asking for a note that does not exist fails loudly rather than inventing one", async () => {
  await withTmpDir(async (root) => {
    const { run } = await helpers(root);
    const got = await run(["profile", "note", "get", "resume-standards"]);
    assert.notEqual(got.code, 0);
    assert.match(got.stderr, /no note named/);
  });
});
