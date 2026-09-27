import { test } from "node:test";
import assert from "node:assert/strict";

import { ProfileStore, RECOMMENDED_PREFERENCE_KEYS } from "../src/services/profile.ts";
import { withTmpDir } from "./helpers.ts";

const makeProfile = (root: string) => new ProfileStore({ dir: root });

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
    await p.recordAnswer("First name", "Mayank");
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
