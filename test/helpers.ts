import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export async function makeTmpDir(prefix = "applymate-test-"): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

export async function withTmpDir<T>(fn: (dir: string) => Promise<T>, prefix?: string): Promise<T> {
  const dir = await makeTmpDir(prefix);
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
