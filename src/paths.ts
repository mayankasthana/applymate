import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";

/** Expand a leading `~` or `~/` to the user's home directory. */
export function expandTilde(p: string | null | undefined): string | null | undefined {
  if (typeof p !== "string") return p;
  if (p === "~") return homedir();
  if (p.startsWith("~/")) return join(homedir(), p.slice(2));
  return p;
}

/** Resolve `p` against `baseDir` when relative; absolute paths pass through. */
export function resolveFrom(baseDir: string, p: string): string {
  return isAbsolute(p) ? p : join(baseDir, p);
}
