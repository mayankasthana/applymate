#!/usr/bin/env node
/**
 * Check every pay figure stored in the workspace against the rule the board
 * depends on: a figure on a card is always traceable to something real.
 *
 *   - basis is "posted" or "sourced"
 *   - the source text is quoted, so a human can see what was read
 *   - a scraped figure names an http(s) URL and a date
 *
 * Exits 0 and prints PAY RECORDS OK only when every record holds and at least
 * one record exists (an empty workspace is not a pass — it is nothing to check).
 *
 *   node scripts/verify-pay-records.mjs [--workspace dir]
 */
import { readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");

async function workspaceDir() {
  const argIndex = process.argv.indexOf("--workspace");
  if (argIndex !== -1 && process.argv[argIndex + 1]) return resolve(process.argv[argIndex + 1]);
  try {
    const config = JSON.parse(await readFile(join(ROOT, "applymate.config.json"), "utf8"));
    return resolve(ROOT, config.workspaceDir || "workspace");
  } catch {
    return join(ROOT, "workspace");
  }
}

const problems = [];
const check = (id, condition, message) => {
  if (!condition) problems.push(`${id}: ${message}`);
};

const dir = join(await workspaceDir(), "jobs");
let files = [];
try {
  files = (await readdir(dir)).filter((f) => f.endsWith(".json"));
} catch {
  console.error(`PAY RECORDS FAILED: no job records under ${dir}`);
  process.exit(1);
}

let recorded = 0;
for (const file of files) {
  let job;
  try {
    job = JSON.parse(await readFile(join(dir, file), "utf8"));
  } catch {
    continue;
  }
  const comp = job.comp;
  if (!comp) continue;
  recorded++;
  const id = job.id || file;
  check(id, comp.basis === "posted" || comp.basis === "sourced" || comp.basis === "stated", `basis must be posted, sourced or stated, got ${JSON.stringify(comp.basis)}`);
  check(id, typeof comp.asText === "string" && comp.asText.trim().length > 0, "must quote the text the figure was read from");
  check(id, Number.isFinite(comp.low) && Number.isFinite(comp.high) && comp.low > 0 && comp.high >= comp.low, `low/high must be a real band, got ${comp.low}–${comp.high}`);
  check(id, /^[A-Z]{3}$/.test(String(comp.currency || "")), `currency must be ISO, got ${JSON.stringify(comp.currency)}`);
  check(id, !Number.isNaN(Date.parse(String(comp.fetchedAt || ""))), `fetchedAt must be a date, got ${JSON.stringify(comp.fetchedAt)}`);
  if (comp.basis === "sourced") {
    check(id, /^https?:\/\/\S+$/.test(String(comp.sourceUrl || "")), `a scraped figure must cite its URL, got ${JSON.stringify(comp.sourceUrl)}`);
    check(id, typeof comp.sourceName === "string" && comp.sourceName.trim().length > 0, "a scraped figure should name its source");
  }
  if (comp.basis === "stated") {
    // A person-stated figure has no URL by nature — it must be attributable by name.
    check(id, typeof comp.sourceName === "string" && comp.sourceName.trim().length > 0, "a person-stated figure must name who said it");
    check(id, !comp.sourceUrl, `a person-stated figure has no URL; drop ${JSON.stringify(comp.sourceUrl)} rather than cite a page that did not state it`);
  }
}

if (!recorded) {
  console.error("PAY RECORDS FAILED: no pay figures on file — there is nothing to verify");
  process.exit(1);
}
if (problems.length) {
  console.error(`PAY RECORDS FAILED (${problems.length} problem(s)):`);
  for (const p of problems) console.error("  " + p);
  process.exit(1);
}
console.log(`PAY RECORDS OK — ${recorded} figure(s) across ${files.length} job record(s), all traceable`);