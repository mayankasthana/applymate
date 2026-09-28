import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";

import { OutreachService, outreachState } from "../src/services/outreach.ts";
import { OutreachMessage, isFollowUpDue, followUpDueAt, FOLLOW_UP_AFTER_DAYS } from "../src/domain.ts";
import { JsonCollection, type Collection } from "../src/adapters/json-collection.ts";
import { runCommand } from "../src/cli.ts";
import { withTmpDir } from "./helpers.ts";
import type { OutreachMessage as OutreachRecord } from "../src/domain.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

function makeCollection(root: string): Collection<OutreachRecord> {
  return new JsonCollection<OutreachRecord>({
    dir: join(root, "outreach"),
    entityName: "outreach message",
    validate: (r) => OutreachMessage.validate(r),
  });
}

const makeService = (root: string) => new OutreachService({ messages: makeCollection(root) });

const INPUT = {
  target: "Dana Reyes",
  targetRole: "hiring-manager" as const,
  channel: "inmail" as const,
  variant: "A1",
  appId: "app-abc123",
  company: "Acme Corp",
  note: "answered the posting",
};

test("OutreachMessage.create generates an id and normalizes optional fields", () => {
  const msg = OutreachMessage.create(INPUT, { now: "2026-09-20T10:00:00.000Z" });
  assert.match(msg.id, /^out-dana-reyes-acme-corp-/);
  assert.equal(msg.target, "Dana Reyes");
  assert.equal(msg.variant, "A1");
  assert.equal(msg.followUpSentAt, null);
  assert.equal(msg.repliedAt, null);
  const bare = OutreachMessage.create({ target: "  Sam ", targetRole: "recruiter", channel: "connection-note" });
  assert.equal(bare.target, "Sam");
  assert.equal(bare.company, null);
  assert.match(bare.id, /^out-sam-/);
});

test("OutreachMessage.create validates role, channel and target", () => {
  assert.throws(() => OutreachMessage.create({ ...INPUT, target: " " }), /target/);
  assert.throws(() => OutreachMessage.create({ ...INPUT, targetRole: "ceo" }), /targetRole/);
  assert.throws(() => OutreachMessage.create({ ...INPUT, channel: "fax" }), /channel/);
});

test("follow-up window: not due before the 4-day mark, due after, retired by reply or follow-up", () => {
  const sentAt = "2026-09-20T10:00:00.000Z";
  const msg = OutreachMessage.create(INPUT, { now: sentAt });
  assert.equal(followUpDueAt(sentAt), Date.parse(sentAt) + FOLLOW_UP_AFTER_DAYS * DAY_MS);
  assert.equal(isFollowUpDue(msg, Date.parse(sentAt) + 3 * DAY_MS), false);
  assert.equal(isFollowUpDue(msg, Date.parse(sentAt) + 4 * DAY_MS), true);
  assert.equal(isFollowUpDue({ ...msg, followUpSentAt: "2026-09-25T10:00:00.000Z" }, Date.parse(sentAt) + 9 * DAY_MS), false);
  assert.equal(isFollowUpDue({ ...msg, repliedAt: "2026-09-21T10:00:00.000Z" }, Date.parse(sentAt) + 9 * DAY_MS), false);
});

test("log persists and get roundtrips", async () => {
  await withTmpDir(async (root) => {
    const svc = makeService(root);
    const msg = await svc.log(INPUT, { now: "2026-09-20T10:00:00.000Z" });
    const fetched = await svc.get(msg.id);
    assert.equal(fetched.target, "Dana Reyes");
    assert.equal((await svc.list()).length, 1);
  });
});

test("list filters: open threads by default, due-only on request, replied with all", async () => {
  await withTmpDir(async (root) => {
    const svc = makeService(root);
    const old = await svc.log(INPUT, { now: "2026-09-01T10:00:00.000Z" });
    const fresh = await svc.log({ ...INPUT, target: "Riley Chen", variant: "B1" }, { now: "2026-09-26T10:00:00.000Z" });
    const replied = await svc.log({ ...INPUT, target: "Old Friend", targetRole: "referrer", channel: "dm" }, { now: "2026-08-20T10:00:00.000Z" });
    await svc.markReplied(replied.id, { at: "2026-08-22T10:00:00.000Z" });

    const open = await svc.list({ now: Date.parse("2026-09-27T00:00:00.000Z") });
    assert.deepEqual(open.map((m) => m.target), ["Riley Chen", "Dana Reyes"]); // newest first

    const due = await svc.list({ due: true, now: Date.parse("2026-09-27T00:00:00.000Z") });
    assert.deepEqual(due.map((m) => m.target), ["Dana Reyes"]); // past window only

    const all = await svc.list({ all: true, now: Date.parse("2026-09-27T00:00:00.000Z") });
    assert.equal(all.length, 3);

    const perApp = await svc.list({ appId: "app-none", now: Date.parse("2026-09-27T00:00:00.000Z") });
    assert.equal(perApp.length, 0);
    assert.ok(fresh && old);
  });
});

test("markFollowedUp records exactly one follow-up and refuses more, or after a reply", async () => {
  await withTmpDir(async (root) => {
    const svc = makeService(root);
    const msg = await svc.log(INPUT, { now: "2026-09-20T10:00:00.000Z" });
    const followed = await svc.markFollowedUp(msg.id, { at: "2026-09-25T10:00:00.000Z" });
    assert.equal(followed.followUpSentAt, "2026-09-25T10:00:00.000Z");
    await assert.rejects(() => svc.markFollowedUp(msg.id), /follow up once/i);

    const other = await svc.log({ ...INPUT, target: "Quinn Fox" }, { now: "2026-09-20T10:00:00.000Z" });
    await svc.markReplied(other.id, { at: "2026-09-21T10:00:00.000Z" });
    await assert.rejects(() => svc.markFollowedUp(other.id), /replied/i);
  });
});

test("markReplied is idempotent and keeps the first reply time", async () => {
  await withTmpDir(async (root) => {
    const svc = makeService(root);
    const msg = await svc.log(INPUT);
    await svc.markReplied(msg.id, { at: "2026-09-21T10:00:00.000Z" });
    const again = await svc.markReplied(msg.id, { at: "2026-09-22T10:00:00.000Z" });
    assert.equal(again.repliedAt, "2026-09-21T10:00:00.000Z");
  });
});

test("outreachState derives the display state", () => {
  const sentAt = "2026-09-20T10:00:00.000Z";
  const msg = OutreachMessage.create(INPUT, { now: sentAt });
  const now = Date.parse(sentAt) + 5 * DAY_MS;
  assert.equal(outreachState(msg, now), "follow-up-due");
  assert.equal(outreachState({ ...msg, followUpSentAt: sentAt }, now), "followed-up");
  assert.equal(outreachState({ ...msg, repliedAt: sentAt }, now), "replied");
  assert.equal(outreachState(msg, Date.parse(sentAt) + DAY_MS), "awaiting-reply");
});

// -- CLI ------------------------------------------------------------------

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

test("outreach CLI: log -> list --due -> followup once -> replied", async () => {
  await withTmpDir(async (root) => {
    await run(["init"], root);
    const tenDaysAgo = new Date(Date.now() - 10 * DAY_MS).toISOString();
    const log = await run(
      ["outreach", "log", "--target", "Dana Reyes", "--role", "hiring-manager", "--channel", "inmail", "--variant", "A1", "--company", "Acme Corp", "--at", tenDaysAgo],
      root
    );
    assert.equal(log.code, 0, log.stderr);
    assert.match(log.stdout, /follow-up becomes due/);
    const id = log.stdout.match(/out-[a-z0-9-]+/)?.[0];
    assert.ok(id, `expected outreach id in output: ${log.stdout}`);

    const due = await run(["outreach", "list", "--due"], root);
    assert.equal(due.code, 0);
    assert.match(due.stdout, /FOLLOW-UP DUE/);
    assert.match(due.stdout, /Dana Reyes/);

    const first = await run(["outreach", "followup", id!], root);
    assert.equal(first.code, 0, first.stderr);
    const second = await run(["outreach", "followup", id!], root);
    assert.equal(second.code, 1);
    assert.match(second.stderr, /follow up once/i);

    const replied = await run(["outreach", "replied", id!], root);
    assert.equal(replied.code, 0);
    const open = await run(["outreach", "list"], root);
    assert.match(open.stdout, /no open outreach/);
    const all = await run(["outreach", "list", "--all"], root);
    assert.match(all.stdout, /replied/);
  });
});

test("outreach CLI: rejects unknown role/channel and missing flags", async () => {
  await withTmpDir(async (root) => {
    await run(["init"], root);
    const bad = await run(["outreach", "log", "--target", "X", "--role", "ceo", "--channel", "inmail"], root);
    assert.equal(bad.code, 1);
    assert.match(bad.stderr, /targetRole/);
    const missing = await run(["outreach", "log", "--target", "X"], root);
    assert.equal(missing.code, 1);
    assert.match(missing.stderr, /--role and --channel/);
  });
});
