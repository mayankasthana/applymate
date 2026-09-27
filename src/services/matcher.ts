import { termCounts, topTerms } from "./terms.ts";
import type { DossierHit, DossierIndex } from "./dossier.ts";

/** Anything that can search a dossier index (structural: DossierIndexer fits). */
export interface DossierSearcher {
  search(index: Pick<DossierIndex, "files" | "keywords">, query: string): DossierHit[];
}

/** JD terms considered for coverage (most frequent first). */
const JD_TERM_LIMIT = 40;

export type Grade = "strong" | "good" | "fair" | "stretch";

const GRADES: { min: number; grade: Grade }[] = [
  { min: 75, grade: "strong" },
  { min: 55, grade: "good" },
  { min: 35, grade: "fair" },
  { min: 0, grade: "stretch" },
];

export function grade(score: number): Grade {
  return GRADES.find((g) => score >= g.min)!.grade;
}

export interface MatchedTerm {
  term: string;
  count: number;
}

export interface MatchReport {
  score: number;
  grade: Grade;
  matched: MatchedTerm[];
  missing: string[];
  coverage: number;
  at: string;
  suggestions?: DossierHit[];
}

/**
 * Quantify how well the dossier covers a job description.
 * When `opts.indexer` is given, also suggests the best dossier documents
 * to tailor from.
 */
export function scoreMatch(
  jobDescription: string,
  dossierIndex: Pick<DossierIndex, "files" | "keywords">,
  { indexer = null, now = new Date().toISOString() }: { indexer?: DossierSearcher | null; now?: string } = {}
): MatchReport {
  const jdTerms = topTerms(termCounts(jobDescription), { limit: JD_TERM_LIMIT });
  const dossierTerms = new Set((dossierIndex.keywords ?? []).map((k) => k.term));

  const matched: MatchedTerm[] = [];
  const missing: string[] = [];
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

  const report: MatchReport = { score, grade: grade(score), matched, missing, coverage: Math.round(coverage * 1000) / 1000, at: now };
  if (indexer) {
    report.suggestions = indexer
      .search(dossierIndex, jdTerms.map((t) => t.term).join(" "))
      .filter((s) => s.kind === "resume" || s.kind === "master-resume")
      .sort((a, b) => (a.kind === "resume" ? 0 : 1) - (b.kind === "resume" ? 0 : 1))
      .slice(0, 5);
  }
  return report;
}
