import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";

import { loadConfig, saveConfig, DEFAULT_CONFIG, configError } from "../src/config.js";
import { withTmpDir } from "./helpers.js";

test("loadConfig returns defaults when no config file exists", async () => {
  await withTmpDir(async (root) => {
    const cfg = await loadConfig(root);
    const { _root, _configPath, _workspaceRoot, _dossierRoot, ...persisted } = cfg;
    assert.deepEqual(persisted, DEFAULT_CONFIG);
  });
});

test("loadConfig merges a stored file over the defaults", async () => {
  await withTmpDir(async (root) => {
    await writeFile(
      join(root, "axa.config.json"),
      JSON.stringify({ dossierDir: "~/dossier", chatPort: 5000 })
    );
    const cfg = await loadConfig(root);
    assert.equal(cfg.dossierDir, "~/dossier");
    assert.equal(cfg.chatPort, 5000);
    assert.equal(cfg.autonomy, "draft"); // untouched default survives
  });
});

test("loadConfig rejects unknown keys", async () => {
  await withTmpDir(async (root) => {
    await writeFile(
      join(root, "axa.config.json"),
      JSON.stringify({ nope: 1 })
    );
    await assert.rejects(() => loadConfig(root), (err) => {
      assert.match(err.message, /unknown config key/i);
      return configError.is(err);
    });
  });
});

test("loadConfig rejects an invalid autonomy value", async () => {
  await withTmpDir(async (root) => {
    await writeFile(
      join(root, "axa.config.json"),
      JSON.stringify({ autonomy: "full-auto-submit" })
    );
    await assert.rejects(() => loadConfig(root), configError.ConfigError);
  });
});

test("loadConfig rejects malformed JSON with a readable error", async () => {
  await withTmpDir(async (root) => {
    await writeFile(join(root, "axa.config.json"), "{not json");
    await assert.rejects(() => loadConfig(root), configError.ConfigError);
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
    await assert.rejects(() => saveConfig(root, { autonomy: "bogus" }), configError.ConfigError);
    await assert.rejects(() => readFile(join(root, "axa.config.json")), { code: "ENOENT" });
  });
});

test("workspaceRoot resolves the workspace under the repo root", async () => {
  await withTmpDir(async (root) => {
    const cfg = await loadConfig(root);
    assert.equal(cfg._workspaceRoot, join(root, "workspace"));
    assert.equal(cfg._root, root);
  });
});
