import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";

import { loadConfig, saveConfig, DEFAULT_CONFIG, ConfigError, type Config } from "../src/config.ts";
import { withTmpDir } from "./helpers.ts";

const persisted = (cfg: Config): Record<string, unknown> => {
  const { _root, _configPath, _workspaceRoot, _dossierRoot, ...rest } = cfg;
  void _root; void _configPath; void _workspaceRoot; void _dossierRoot;
  return rest;
};

test("loadConfig returns defaults when no config file exists", async () => {
  await withTmpDir(async (root) => {
    const cfg = await loadConfig(root);
    assert.deepEqual(persisted(cfg), { ...DEFAULT_CONFIG });
  });
});

test("loadConfig merges a stored file over the defaults", async () => {
  await withTmpDir(async (root) => {
    await writeFile(join(root, "axa.config.json"), JSON.stringify({ dossierDir: "~/dossier", chatPort: 5000 }));
    const cfg = await loadConfig(root);
    assert.equal(cfg.dossierDir, "~/dossier");
    assert.equal(cfg.chatPort, 5000);
    assert.equal(cfg.autonomy, "draft"); // untouched default survives
  });
});

test("loadConfig rejects unknown keys", async () => {
  await withTmpDir(async (root) => {
    await writeFile(join(root, "axa.config.json"), JSON.stringify({ nope: 1 }));
    await assert.rejects(
      () => loadConfig(root),
      (err) => err instanceof ConfigError && /unknown config key/i.test(err.message)
    );
  });
});

test("loadConfig rejects an invalid autonomy value", async () => {
  await withTmpDir(async (root) => {
    await writeFile(join(root, "axa.config.json"), JSON.stringify({ autonomy: "full-auto-submit" }));
    await assert.rejects(() => loadConfig(root), ConfigError);
  });
});

test("loadConfig rejects an invalid minMatchScore", async () => {
  await withTmpDir(async (root) => {
    await writeFile(join(root, "axa.config.json"), JSON.stringify({ minMatchScore: 250 }));
    await assert.rejects(() => loadConfig(root), ConfigError);
  });
});

test("loadConfig rejects malformed JSON with a readable error", async () => {
  await withTmpDir(async (root) => {
    await writeFile(join(root, "axa.config.json"), "{not json");
    await assert.rejects(() => loadConfig(root), ConfigError);
  });
});

test("saveConfig writes defaults + patch and a later load sees them", async () => {
  await withTmpDir(async (root) => {
    await saveConfig(root, { dossierDir: "~/cv" });
    const raw = JSON.parse(await readFile(join(root, "axa.config.json"), "utf8"));
    assert.equal(raw.dossierDir, "~/cv");
    assert.equal(raw.autonomy, "draft");

    await saveConfig(root, { chatPort: 4999 });
    const cfg = await loadConfig(root);
    assert.equal(cfg.dossierDir, "~/cv");
    assert.equal(cfg.chatPort, 4999);
  });
});

test("saveConfig rejects invalid patches and writes nothing", async () => {
  await withTmpDir(async (root) => {
    await assert.rejects(() => saveConfig(root, { autonomy: "bogus" as never }), ConfigError);
    await assert.rejects(() => readFile(join(root, "axa.config.json")), { code: "ENOENT" });
  });
});

test("derived paths resolve under the repo root", async () => {
  await withTmpDir(async (root) => {
    const cfg = await loadConfig(root);
    assert.equal(cfg._workspaceRoot, join(root, "workspace"));
    assert.equal(cfg._root, root);
    assert.equal(cfg._dossierRoot, null);
  });
});
