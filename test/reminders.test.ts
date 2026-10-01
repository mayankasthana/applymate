import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";

import { ReminderService, reminderState } from "../src/services/reminders.ts";
import { Reminder, isReminderDue } from "../src/domain.ts";
import { JsonCollection, type Collection } from "../src/adapters/json-collection.ts";
import { runCommand } from "../src/cli.ts";
import { withTmpDir } from "./helpers.ts";
import type { Reminder as ReminderRecord } from "../src/domain.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

function makeCollection(root: string): Collection<ReminderRecord> {
  return new JsonCollection<ReminderRecord>({
    dir: join(root, "reminders"),
    entityName: "reminder",
    validate: (r) => Reminder.validate(r),
  });
}

const makeService = (root: string) => new ReminderService({ reminders: makeCollection(root) });

const INPUT = {
  title: "submit cold if no referral",
  dueAt: "2026-09-30",
  appId: "app-abc123",
  note: "fallback rule decided 2026-09-29",
};

test("Reminder.create generates an id and normalizes optional fields", () => {
  const rem = Reminder.create(INPUT, { now: "2026-09-29T10:00:00.000Z" });
  assert.match(rem.id, /^rem-submit-cold-if-no-referral-/);
  assert.equal(rem.title, "submit cold if no referral");
  assert.equal(rem.dueAt, "2026-09-30");
  assert.equal(rem.doneAt, null);
  const bare = Reminder.create({ title: "  Ping Dana  ", dueAt: "2026-10-04T09:00:00Z" });
  assert.equal(bare.title, "Ping Dana");
  assert.equal(bare.appId, null);
  assert.match(bare.id, /^rem-ping-dana-/);
});

test("Reminder.create validates title and due date", () => {
  assert.throws(() => Reminder.create({ ...INPUT, title: " " }), /title/);
  assert.throws(() => Reminder.create({ ...INPUT, dueAt: " " }), /dueAt/);
  assert.throws(() => Reminder.create({ ...INPUT, dueAt: "not-a-date" }), /dueAt/);
});

test("isReminderDue: open + past due only; done never due", () => {
  const rem = Reminder.create(INPUT, { now: "2026-09-29T10:00:00.000Z" });
  assert.equal(isReminderDue(rem, Date.parse("2026-09-29T23:59:59Z")), false);
  assert.equal(isReminderDue(rem, Date.parse("2026-09-30T00:00:00Z")), true);
  assert.equal(isReminderDue({ ...rem, doneAt: "2026-09-29T12:00:00Z" }, Date.parse("2026-10-05T00:00:00Z")), false);
});

test("add persists, get roundtrips, list sorts soonest-first and filters", async () => {
  await withTmpDir(async (root) => {
    const svc = makeService(root);
    const later = await svc.add({ ...INPUT, title: "later thing", dueAt: "2026-10-10" }, { now: "2026-09-29T10:00:00.000Z" });
    const sooner = await svc.add(INPUT, { now: "2026-09-29T10:00:00.000Z" });
    const done = await svc.add({ ...INPUT, title: "finished thing", dueAt: "2026-09-20" }, { now: "2026-09-15T10:00:00.000Z" });
    await svc.markDone(done.id, { at: "2026-09-18T10:00:00.000Z" });

    const fetched = await svc.get(sooner.id);
    assert.equal(fetched.appId, "app-abc123");

    const open = await svc.list({ now: Date.parse("2026-09-29T12:00:00.000Z") });
    assert.deepEqual(open.map((r) => r.title), ["submit cold if no referral", "later thing"]); // dueAt ascending

    const due = await svc.list({ due: true, now: Date.parse("2026-10-01T00:00:00.000Z") });
    assert.deepEqual(due.map((r) => r.title), ["submit cold if no referral"]); // done excluded, past window only

    const all = await svc.list({ all: true, now: Date.parse("2026-10-01T00:00:00.000Z") });
    assert.equal(all.length, 3);

    const perApp = await svc.list({ appId: "app-none", now: Date.parse("2026-10-01T00:00:00.000Z") });
    assert.equal(perApp.length, 0);
    assert.ok(later);
  });
});

test("markDone keeps the first done time and is idempotent", async () => {
  await withTmpDir(async (root) => {
    const svc = makeService(root);
    const rem = await svc.add(INPUT);
    const done = await svc.markDone(rem.id, { at: "2026-10-01T09:00:00.000Z" });
    assert.equal(done.doneAt, "2026-10-01T09:00:00.000Z");
    const again = await svc.markDone(rem.id, { at: "2026-10-02T09:00:00.000Z" });
    assert.equal(again.doneAt, "2026-10-01T09:00:00.000Z");
  });
});

test("reminderState derives the display state", () => {
  const rem = Reminder.create(INPUT, { now: "2026-09-29T10:00:00.000Z" });
  assert.equal(reminderState(rem, Date.parse("2026-09-29T11:00:00Z")), "upcoming");
  assert.equal(reminderState(rem, Date.parse("2026-09-30T00:00:00Z")), "due");
  assert.equal(reminderState({ ...rem, doneAt: "2026-09-29T12:00:00Z" }, Date.parse("2026-10-05T00:00:00Z")), "done");
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

test("reminders CLI: add -> list -> list --due -> done -> list --all", async () => {
  await withTmpDir(async (root) => {
    await run(["init"], root);
    const add = await run(
      ["reminders", "add", "submit TR cold if no referral", "--due", "2027-01-15", "--app", "app-4cgf", "--note", "fallback rule", "--at", "2026-09-29T10:00:00.000Z"],
      root
    );
    assert.equal(add.code, 0, add.stderr);
    const id = add.stdout.match(/rem-[a-z0-9-]+/)?.[0];
    assert.ok(id, `expected reminder id in output: ${add.stdout}`);

    const upcoming = await run(["reminders", "list"], root);
    assert.equal(upcoming.code, 0);
    assert.match(upcoming.stdout, /due 2027-01-15/);
    assert.match(upcoming.stdout, /submit TR cold if no referral/);

    // simulate the date moving past the due point via a second, already-due entry
    const past = await run(
      ["reminders", "add", "salesforce direct-apply clock", "--due", "2020-01-01", "--app", "app-1wga", "--at", "2019-12-25T00:00:00.000Z"],
      root
    );
    assert.equal(past.code, 0, past.stderr);
    const due = await run(["reminders", "list", "--due"], root);
    assert.equal(due.code, 0);
    assert.match(due.stdout, /DUE/);
    assert.match(due.stdout, /salesforce direct-apply clock/);
    assert.doesNotMatch(due.stdout, /submit TR cold if no referral/);

    const done = await run(["reminders", "done", id!], root);
    assert.equal(done.code, 0, done.stderr);
    assert.match(done.stdout, /done at/);

    const open = await run(["reminders", "list"], root);
    assert.doesNotMatch(open.stdout, /submit TR cold if no referral/);
    const all = await run(["reminders", "list", "--all"], root);
    assert.match(all.stdout, /done \d{4}-\d{2}-\d{2}/);
    assert.match(all.stdout, /submit TR cold if no referral/);
  });
});

test("reminders CLI: rejects missing title, bad or missing --due", async () => {
  await withTmpDir(async (root) => {
    await run(["init"], root);
    const noTitle = await run(["reminders", "add", "--due", "2026-10-01"], root);
    assert.equal(noTitle.code, 1);
    assert.match(noTitle.stderr, /title/);
    const noDue = await run(["reminders", "add", "some decision"], root);
    assert.equal(noDue.code, 1);
    assert.match(noDue.stderr, /--due/);
    const badDue = await run(["reminders", "add", "some decision", "--due", "next tuesday"], root);
    assert.equal(badDue.code, 1);
    assert.match(badDue.stderr, /--due/);
    const doneMissing = await run(["reminders", "done", "rem-does-not-exist"], root);
    assert.equal(doneMissing.code, 1);
  });
});
