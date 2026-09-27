import { mkdir, writeFile, rename } from "node:fs/promises";
import { dirname } from "node:path";

/**
 * Write a file atomically: content lands via a temp file + rename, so readers
 * never observe a half-written file. Used by every persistence adapter.
 */
export async function writeFileAtomic(filePath: string, data: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tmp, data);
  await rename(tmp, filePath);
}

export async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  return writeFileAtomic(filePath, `${JSON.stringify(value, null, 2)}\n`);
}
