#!/usr/bin/env node
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { runCommand } from "../src/cli.ts";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const code = await runCommand(process.argv.slice(2), {
  rootDir: repoRoot,
  stdout: process.stdout,
  stderr: process.stderr,
});
process.exit(code);
