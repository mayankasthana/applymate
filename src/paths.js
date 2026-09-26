import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";

/** Expand a leading `~` or `~/` to the user's home directory. */
export function expandTilde(p) {
  if (typeof p !== "string") return p;
  if (p === "~") return homedir();
  if (p.startsWith("~/")) return join(homedir(), p.slice(2));
  return p;
}

/** Resolve `p` against `baseDir` when relative; absolute paths pass through. */
export function resolveFrom(baseDir, p) {
  return isAbsolute(p) ? p : join(baseDir, p);
}
