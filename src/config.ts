import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { resolveFrom } from "./paths.ts";
import { writeJsonAtomic } from "./fsutil.ts";

export const CONFIG_FILE = "applymate.config.json";

export interface PersistedConfig {
  /** Absolute path or ~/ path to the resume dossier directory. */
  dossierDir: string | null;
  /** Where jobs, applications, chat state live (relative to repo root). */
  workspaceDir: string;
  /** "draft": agent produces artifacts only; "assist": agent may also fill
   *  external forms the user reviews. Submission is always human-gated. */
  autonomy: "draft" | "assist";
  /** Port for the local chat/review UI. */
  chatPort: number;
  /** Applications below this dossier-match score are refused unless forced. */
  minMatchScore: number;
  /** Glob patterns forcing dossier files into the match vocabulary (evidence of real experience); wins over reference globs. */
  dossierProfileGlobs: string[];
  /** Glob patterns keeping dossier files out of the match vocabulary (prep, archives). */
  dossierReferenceGlobs: string[];
}

/** Loaded config plus derived absolute paths (prefixed `_`, never persisted). */
export interface Config extends PersistedConfig {
  _root: string;
  _configPath: string;
  _workspaceRoot: string;
  _dossierRoot: string | null;
}

export const DEFAULT_CONFIG: Readonly<PersistedConfig> = Object.freeze({
  dossierDir: null,
  workspaceDir: "workspace",
  autonomy: "draft",
  chatPort: 4388,
  minMatchScore: 60,
  dossierProfileGlobs: [],
  dossierReferenceGlobs: [],
});

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

const KNOWN_KEYS: ReadonlySet<string> = new Set(Object.keys(DEFAULT_CONFIG));
const AUTONOMY_VALUES: ReadonlySet<string> = new Set(["draft", "assist"]);

function validate(patch: Record<string, unknown>): void {
  for (const key of Object.keys(patch)) {
    if (!KNOWN_KEYS.has(key)) {
      throw new ConfigError(`unknown config key: ${key} (known: ${[...KNOWN_KEYS].join(", ")})`);
    }
  }
  if (patch.autonomy !== undefined && !AUTONOMY_VALUES.has(patch.autonomy as string)) {
    throw new ConfigError(`autonomy must be one of: ${[...AUTONOMY_VALUES].join(", ")}`);
  }
  if (patch.chatPort !== undefined) {
    const port = patch.chatPort as number;
    if (!Number.isInteger(port) || port < 1024 || port > 65535) {
      throw new ConfigError("chatPort must be an integer between 1024 and 65535");
    }
  }
  if (patch.minMatchScore !== undefined) {
    const min = patch.minMatchScore as number;
    if (!Number.isInteger(min) || min < 0 || min > 100) {
      throw new ConfigError("minMatchScore must be an integer between 0 and 100");
    }
  }
  const dossier = patch.dossierDir;
  if (dossier !== null && dossier !== undefined && typeof dossier !== "string") {
    throw new ConfigError("dossierDir must be a string path or null");
  }
  for (const key of ["dossierProfileGlobs", "dossierReferenceGlobs"] as const) {
    const globs = patch[key];
    if (globs !== undefined && (!Array.isArray(globs) || globs.some((g) => typeof g !== "string"))) {
      throw new ConfigError(`${key} must be an array of glob strings`);
    }
  }
}

function validateLoaded(merged: PersistedConfig): void {
  validate({
    autonomy: merged.autonomy,
    chatPort: merged.chatPort,
    dossierDir: merged.dossierDir,
    minMatchScore: merged.minMatchScore,
    dossierProfileGlobs: merged.dossierProfileGlobs,
    dossierReferenceGlobs: merged.dossierReferenceGlobs,
  });
  if (typeof merged.workspaceDir !== "string" || merged.workspaceDir.length === 0) {
    throw new ConfigError("workspaceDir must be a non-empty string");
  }
}

/** Load `applymate.config.json` merged over defaults, with derived paths attached. */
export async function loadConfig(rootDir: string): Promise<Config> {
  let stored: Record<string, unknown> = {};
  let raw: string | undefined;
  try {
    raw = await readFile(join(rootDir, CONFIG_FILE), "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      throw new ConfigError(`cannot read ${CONFIG_FILE}: ${(err as Error).message}`);
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
  const merged = { ...DEFAULT_CONFIG, ...stored } as PersistedConfig;
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
export async function saveConfig(rootDir: string, patch: Partial<PersistedConfig>): Promise<Config> {
  validate(patch as Record<string, unknown>);
  const current = await loadConfig(rootDir);
  const { _root: _r, _configPath: _c, _workspaceRoot: _w, _dossierRoot: _d, ...persisted } = current;
  const next: PersistedConfig = { ...persisted, ...patch };
  await writeJsonAtomic(join(rootDir, CONFIG_FILE), next);
  return loadConfig(rootDir);
}
