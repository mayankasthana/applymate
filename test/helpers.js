import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export async function makeTmpDir(prefix = "axa-test-") {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  return dir;
}

export async function withTmpDir(fn, prefix) {
  const dir = await makeTmpDir(prefix);
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
