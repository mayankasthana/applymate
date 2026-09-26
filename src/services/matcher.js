import { termCounts, topTerms } from "./terms.js";

/** JD terms considered for coverage (most frequent first). */
const JD_TERM_LIMIT = 40;

const GRADES = [
  { min: 75, grade: "strong" },
  { min: 55, grade: "good" },
  { min: 35, grade: "fair" },
  { min: 0, grade: "stretch" },
];

export function grade(score) {
  return GRADES.find((g) => score >= g.min).grade;
}

/**
 * Quantify how well the dossier covers a job description.
 *
 * @returns {{score:number, grade:string, matched:Array<{term,count}>,
 *            missing:string[], coverage:number, at:string, suggestions?:Array}}
 *          `suggestions` (best dossier docs to tailor from) is included when
 *          `opts.indexer` is provided.
 */
export function scoreMatch(jobDescription, dossierIndex, { indexer = null, now = new Date().toISOString() } = {}) {
  const jdTerms = topTerms(termCounts(jobDescription), { limit: JD_TERM_LIMIT });
  const dossierTerms = new Set((dossierIndex.keywords ?? []).map((k) => k.term));

  const matched = [];
  const missing = [];
  let weightTotal = 0;
  let weightMatched = 0;
  for (const { term, count } of jdTerms) {
    weightTotal += count;
    if (dossierTerms.has(term)) {
      matched.push({ term, count });
      weightMatched += count;
    } else {
      missing.push(term);
    }
  }
  missing.sort((a, b) => b.length - a.length || a.localeCompare(b)); // longer/specific first

  // Frequency-weighted coverage: a term the JD repeats matters more than a
  // one-off mention (company names, boilerplate), so noise drags less.
  const coverage = weightTotal === 0 ? 0 : weightMatched / weightTotal;
  const score = Math.round(coverage * 100);

  const report = { score, grade: grade(score), matched, missing, coverage: Math.round(coverage * 1000) / 1000, at: now };
  if (indexer) {
    report.suggestions = indexer
      .search(dossierIndex, jdTerms.map((t) => t.term).join(" "))
      .filter((s) => s.kind === "resume" || s.kind === "master-resume")
      .sort((a, b) => (a.kind === "resume" ? 0 : 1) - (b.kind === "resume" ? 0 : 1))
      .slice(0, 5);
  }
  return report;
}
