import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { appendFile } from "node:fs/promises";

import { ChatLog } from "../src/services/inbox.ts";
import { withTmpDir } from "./helpers.ts";

const makeLog = (root: string) => new ChatLog({ filePath: join(root, "chat", "log.jsonl") });

test("append assigns sequential ids and persists to disk", async () => {
  await withTmpDir(async (root) => {
    const log = makeLog(root);
    const m1 = await log.append({ from: "user", text: "hello agent" });
    const m2 = await log.append({ from: "agent", text: "hello captain" });
    assert.equal(m1.id, 1);
    assert.equal(m2.id, 2);
    const reloaded = new ChatLog({ filePath: join(root, "chat", "log.jsonl") });
    const all = await reloaded.list();
    assert.equal(all.length, 2);
    assert.equal(all[1]!.text, "hello captain");
  });
});

test("append records timestamps and optional meta", async () => {
  await withTmpDir(async (root) => {
    const log = makeLog(root);
    const m = await log.append({ from: "user", text: "look at app-x", meta: { appId: "app-x" } });
    assert.ok(m.at);
    assert.equal((m.meta as { appId: string }).appId, "app-x");
  });
});

test("append validates sender and text", async () => {
  await withTmpDir(async (root) => {
    const log = makeLog(root);
    await assert.rejects(() => log.append({ from: "ghost" as never, text: "boo" }), /from/i);
    await assert.rejects(() => log.append({ from: "user", text: "   " }), /text/i);
  });
});

test("since(n) returns only messages newer than n", async () => {
  await withTmpDir(async (root) => {
    const log = makeLog(root);
    await log.append({ from: "user", text: "one" });
    await log.append({ from: "agent", text: "two" });
    const newer = await log.list({ since: 1 });
    assert.deepEqual(newer.map((m) => m.id), [2]);
    assert.deepEqual((await log.list({ since: 0 })).map((m) => m.id), [1, 2]);
  });
});

test("a torn trailing write is tolerated on load", async () => {
  await withTmpDir(async (root) => {
    const path = join(root, "chat", "log.jsonl");
    const log = new ChatLog({ filePath: path });
    await log.append({ from: "user", text: "fine" });
    await appendFile(path, '{"id":2,"from":"user","tex'); // torn line, no newline
    const reloaded = new ChatLog({ filePath: path });
    const all = await reloaded.list();
    assert.equal(all.length, 1);
    const next = await reloaded.append({ from: "agent", text: "recovered" });
    assert.equal(next.id, 2); // appends continue from the last good id
  });
});

test("poll with waitMs=0 returns immediately (messages or empty)", async () => {
  await withTmpDir(async (root) => {
    const log = makeLog(root);
    assert.deepEqual(await log.poll({ since: 0, waitMs: 0 }), []);
    await log.append({ from: "user", text: "now" });
    const msgs = await log.poll({ since: 0, waitMs: 0 });
    assert.equal(msgs.length, 1);
  });
});

test("poll waits for a user message that arrives while waiting", async () => {
  await withTmpDir(async (root) => {
    const log = makeLog(root);
    setTimeout(() => void log.append({ from: "user", text: "late message" }), 250);
    const msgs = await log.poll({ since: 0, waitMs: 5000 });
    assert.equal(msgs.length, 1);
    assert.equal(msgs[0]!.text, "late message");
  });
});

test("poll ignores agent messages when waiting for the captain", async () => {
  await withTmpDir(async (root) => {
    const log = makeLog(root);
    setTimeout(() => void log.append({ from: "agent", text: "self talk" }), 100);
    assert.deepEqual(await log.poll({ since: 0, waitMs: 400 }), []);
  });
});

test("poll times out quietly with an empty list", async () => {
  await withTmpDir(async (root) => {
    const log = makeLog(root);
    const start = Date.now();
    assert.deepEqual(await log.poll({ since: 0, waitMs: 300 }), []);
    assert.ok(Date.now() - start >= 250, "should have waited ~300ms");
  });
});
