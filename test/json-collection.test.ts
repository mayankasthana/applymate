import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";

import { JsonCollection, StoreError } from "../src/adapters/json-collection.ts";
import { withTmpDir } from "./helpers.ts";

interface Thing {
  id: string;
  name: string;
  createdAt: string;
}

const validate = (rec: Thing): Thing => {
  if (!rec.name) throw new Error("record needs a name");
  return rec;
};

const makeStore = (root: string, name = "things") =>
  new JsonCollection<Thing>({ dir: join(root, name), entityName: name, validate });

test("put then get roundtrips a record", async () => {
  await withTmpDir(async (root) => {
    const store = makeStore(root);
    await store.put({ id: "t-one", name: "one", createdAt: "2026-01-01T00:00:00Z" });
    const got = await store.get("t-one");
    assert.equal(got.name, "one");
  });
});

test("get on a missing id throws StoreError with code NOT_FOUND", async () => {
  await withTmpDir(async (root) => {
    const store = makeStore(root);
    await assert.rejects(
      () => store.get("nope"),
      (err) => err instanceof StoreError && err.code === "NOT_FOUND"
    );
  });
});

test("list returns every record sorted by createdAt then id", async () => {
  await withTmpDir(async (root) => {
    const store = makeStore(root);
    await store.put({ id: "b", name: "b", createdAt: "2026-01-02T00:00:00Z" });
    await store.put({ id: "c", name: "c", createdAt: "2026-01-01T00:00:00Z" });
    await store.put({ id: "a", name: "a", createdAt: "2026-01-01T00:00:00Z" });
    const all = await store.list();
    assert.deepEqual(all.map((r) => r.id), ["a", "c", "b"]);
  });
});

test("put overwrites an existing record with the same id", async () => {
  await withTmpDir(async (root) => {
    const store = makeStore(root);
    await store.put({ id: "t-one", name: "one", createdAt: "t1" });
    await store.put({ id: "t-one", name: "one-again", createdAt: "t1" });
    const got = await store.get("t-one");
    assert.equal(got.name, "one-again");
    assert.equal((await store.list()).length, 1);
  });
});

test("the validate hook runs on both write and read", async () => {
  await withTmpDir(async (root) => {
    const store = makeStore(root);
    await assert.rejects(() => store.put({ id: "t-bad", name: "", createdAt: "t" } as Thing), StoreError);
    const { writeFile, mkdir } = await import("node:fs/promises");
    await mkdir(join(root, "things"), { recursive: true });
    await writeFile(join(root, "things", "t-corrupt.json"), JSON.stringify({ id: "t-corrupt" }));
    await assert.rejects(() => store.list(), /invalid things record/i);
  });
});

test("delete removes a record and rejects on a missing one", async () => {
  await withTmpDir(async (root) => {
    const store = makeStore(root);
    await store.put({ id: "t-one", name: "one", createdAt: "t1" });
    await store.delete("t-one");
    assert.deepEqual(await store.list(), []);
    await assert.rejects(() => store.delete("t-one"), (err: unknown) => (err as StoreError).code === "NOT_FOUND");
  });
});

test("list on a directory that does not exist yet returns empty", async () => {
  await withTmpDir(async (root) => {
    const store = makeStore(root);
    assert.deepEqual(await store.list(), []);
  });
});

test("find returns the first record matching the predicate or null", async () => {
  await withTmpDir(async (root) => {
    const store = makeStore(root);
    await store.put({ id: "t-one", name: "one", createdAt: "t1" });
    await store.put({ id: "t-two", name: "two", createdAt: "t2" });
    assert.equal((await store.find((r) => r.name === "two"))!.id, "t-two");
    assert.equal(await store.find((r) => r.name === "zzz"), null);
  });
});
