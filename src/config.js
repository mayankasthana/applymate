import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { resolveFrom } from "./paths.js";
import { writeJsonAtomic } from "./fsutil.js";

export const CONFIG_FILE = "axa.config.json";

export const DEFAULT_CONFIG = Object.freeze({
  /** Absolute path or ~/ path to the resume dossier directory. */
  dossierDir: null,
  /** Where jobs, applications, chat state live (relative to repo root). */
  workspaceDir: "workspace",
  /** "draft": agent produces artifacts only; "assist": agent may also fill
   *  external forms the user reviews. Submission is always human-gated. */
  autonomy: "draft",
  /** Port for the local chat/review UI. */
  chatPort: 4388,
});

export class ConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = "ConfigError";
  }
}

export const configError = {
  ConfigError,
  is: (err) => err instanceof ConfigError,
};

const KNOWN_KEYS = new Set(Object.keys(DEFAULT_CONFIG));
const AUTONOMY_VALUES = new Set(["draft", "assist"]);

function validate(patch) {
  for (const key of Object.keys(patch)) {
    if (!KNOWN_KEYS.has(key)) {
      throw new ConfigError(`unknown config key: ${key} (known: ${[...KNOWN_KEYS].join(", ")})`);
    }
  }
  if (patch.autonomy !== undefined && !AUTONOMY_VALUES.has(patch.autonomy)) {
    throw new ConfigError(`autonomy must be one of: ${[...AUTONOMY_VALUES].join(", ")}`);
  }
  if (patch.chatPort !== undefined) {
    const port = patch.chatPort;
    if (!Number.isInteger(port) || port < 1024 || port > 65535) {
      throw new ConfigError("chatPort must be an integer between 1024 and 65535");
    }
  }
  if (patch.dossierDir !== null && patch.dossierDir !== undefined && typeof patch.dossierDir !== "string") {
    throw new ConfigError("dossierDir must be a string path or null");
  }
}

function validateLoaded(merged) {
  validate({ autonomy: merged.autonomy, chatPort: merged.chatPort, dossierDir: merged.dossierDir });
  if (typeof merged.workspaceDir !== "string" || merged.workspaceDir.length === 0) {
    throw new ConfigError("workspaceDir must be a non-empty string");
  }
}

/** Load `axa.config.json` merged over defaults. Derived paths are prefixed `_`. */
export async function loadConfig(rootDir) {
  let stored = {};
  let raw;
  try {
    raw = await readFile(join(rootDir, CONFIG_FILE), "utf8");
  } catch (err) {
    if (err.code !== "ENOENT") {
      throw new ConfigError(`cannot read ${CONFIG_FILE}: ${err.message}`);
    }
  }
  if (raw !== undefined) {
    try {
      stored = JSON.parse(raw);
    } catch {
      throw new ConfigError(`${CONFIG_FILE} is not valid JSON`);
    }
    if (stored === null || typeof stored !== "object" || Array.isArray(stored)) {
      throw new ConfigError(`${CONFIG_FILE} must contain a JSON object`);
    }
  }
  validate(stored);
  const merged = { ...DEFAULT_CONFIG, ...stored };
  validateLoaded(merged);
  return {
    ...merged,
    _root: rootDir,
    _configPath: join(rootDir, CONFIG_FILE),
    _workspaceRoot: resolveFrom(rootDir, merged.workspaceDir),
    _dossierRoot: merged.dossierDir === null ? null : resolveFrom(rootDir, merged.dossierDir),
  };
}

/** Merge `patch` over the current config and persist it atomically. */
export async function saveConfig(rootDir, patch) {
  validate(patch);
  const current = await loadConfig(rootDir);
  const { _root, _configPath, _workspaceRoot, _dossierRoot, ...persisted } = current;
  const next = { ...persisted, ...patch };
  await writeJsonAtomic(join(rootDir, CONFIG_FILE), next);
  return loadConfig(rootDir);
}
