import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

/**
 * Repo hygiene guard. This repo is meant to be publishable, so the things that
 * must never enter it are enforced here rather than left to care: personal
 * workspace state, machine-local config, and anything binary or home-scoped.
 *
 * Author identity in commit metadata is deliberately NOT checked — that is the
 * publisher's call, not a policy this suite can enforce.
 */

const exec = promisify(execFile);

/** Repository root: two levels up from test/. */
const ROOT = join(import.meta.dirname, "..");

async function git(...args: string[]): Promise<string> {
  const { stdout } = await exec("git", args, { cwd: ROOT });
  return stdout;
}

/** Paths git currently tracks. Null when git is unavailable or this is not a work tree. */
async function trackedFiles(): Promise<string[] | null> {
  try {
    const out = await git("ls-files");
    return out.split("\n").filter(Boolean);
  } catch {
    return null;
  }
}

/** Skip cleanly outside a git checkout (npm tarball, CI copy) rather than fail. */
async function trackedOrSkip(t: { skip: (reason: string) => void }): Promise<string[] | null> {
  const files = await trackedFiles();
  if (!files) t.skip("not a git work tree");
  return files;
}

test("workspace state and machine-local config are never tracked", async (t) => {
  const files = await trackedOrSkip(t);
  if (!files) return;
  const leaked = files.filter((f) => f.startsWith("workspace/") || f === "applymate.config.json");
  assert.deepEqual(leaked, [], `personal state must stay gitignored, but these are tracked: ${leaked.join(", ")}`);
});

test("no document binaries are tracked (dossier content must not leak)", async (t) => {
  const files = await trackedOrSkip(t);
  if (!files) return;
  const binaries = files.filter((f) => /\.(pdf|docx?|xlsx?|pptx?|key|pem|p12|sqlite3?|db)$/i.test(f));
  assert.deepEqual(binaries, [], `these look like personal documents: ${binaries.join(", ")}`);
});

test("no file embeds a machine-local home path", async (t) => {
  const files = await trackedOrSkip(t);
  if (!files) return;
  const offenders: string[] = [];
  for (const file of files) {
    let text: string;
    try {
      text = await readFile(join(ROOT, file), "utf8");
    } catch {
      continue; // binary or unreadable; the binary rule above covers those
    }
    // /Users/<name>/... leaks whose home directory this is.
    for (const m of text.matchAll(/\/(?:Users|home)\/[A-Za-z0-9._-]+\//g)) {
      // Docs intentionally show ~/Docs-style placeholders, never a real /Users path.
      offenders.push(`${file}: ${m[0]}`);
    }
  }
  assert.deepEqual(offenders, [], `absolute home paths must not be committed:\n${offenders.join("\n")}`);
});

test("no file embeds a real-looking personal email", async (t) => {
  const files = await trackedOrSkip(t);
  if (!files) return;
  const offenders: string[] = [];
  // example.com / example.org are reserved for docs; anything else is suspect.
  for (const file of files) {
    let text: string;
    try {
      text = await readFile(join(ROOT, file), "utf8");
    } catch {
      continue;
    }
    for (const m of text.matchAll(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g)) {
      if (/@(example\.(com|org|net)|localhost|users\.noreply\.github\.com)\b/.test(m[0])) continue;
      if (file === "package-lock.json") continue;
      offenders.push(`${file}: ${m[0]}`);
    }
  }
  assert.deepEqual(offenders, [], `emails must not be committed:\n${offenders.join("\n")}`);
});

test("the contract states resume rules without hardcoding one candidate's facts", async () => {
  const agents = await readFile(join(ROOT, "AGENTS.md"), "utf8");
  // The rules stay; the candidate's specifics must be referenced from the
  // workspace instead of inlined, so the repo can be published as-is.
  assert.match(agents, /profile note get resume-standards/, "AGENTS.md should point at the workspace note");
  assert.doesNotMatch(
    agents,
    /[A-Z][a-z]+_[A-Z][a-z]+_Resume/,
    "AGENTS.md must not inline a personal resume filename"
  );
});

test("gitignore covers the private stores and build artifacts", async () => {
  const ignore = await readFile(join(ROOT, ".gitignore"), "utf8");
  for (const rule of ["workspace/", "applymate.config.json", "__pycache__/"]) {
    assert.ok(ignore.includes(rule), `.gitignore must ignore ${rule}`);
  }
});