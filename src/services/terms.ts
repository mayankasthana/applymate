/**
 * Lightweight term extraction for keyword matching between a resume dossier
 * and a job description. Deliberately dependency-free and tech-token aware:
 * tokens like "c++", "ci/cd" and "node.js" survive tokenization.
 */

const STOPWORDS: ReadonlySet<string> = new Set(
  `a about above able across after again against all along already also although always among
   an and any anyone anything are around as at back be because been before being below best better
   between both build building built but by can cannot come could did do does doing done down due
   during each either else enough etc even ever every few for from further get gets give given
   goes going good got had has have having help helped helping her here hers herself him himself
   his how however i if in include includes including into is it its itself just keep kept know
   known like likely made make makes many may me might mine more most much must my myself near
   need needs neither never new next no nor not now of off often on once one only onto or other
   others our ours ourselves out over own per plus rather really same several she should since so
   some someone something such take takes than that the their theirs them themselves then there
   these team teams they this those through thus to too toward two under until up upon us use used
   uses using various very via want was way we well were what when where whether which while who
   whom why will with within without work worked working works would year years yet you your yours
   yourself`
    .split(/\s+/)
    .filter(Boolean)
);

const TOKEN_RE = /[a-z0-9][a-z0-9+#./_-]*/g;
// Trailing "+" and "#" are kept: they are part of tech names (c++, f#).
const EDGE_JUNK = /^[#+./_-]+|[./_-]+$/g;

/** Lowercased tokens: stopwords, pure numbers, and 1-char tokens removed.
 *  The floor is 2 chars on purpose — "go", "js", "ai", "ux" are real tech terms. */
export function extractTerms(text: string | null | undefined): string[] {
  if (!text) return [];
  const lowered = String(text).toLowerCase();
  const out: string[] = [];
  for (const raw of lowered.match(TOKEN_RE) ?? []) {
    const token = raw.replace(EDGE_JUNK, "");
    if (token.length < 2) continue;
    if (/^\d+$/.test(token)) continue;
    if (STOPWORDS.has(token)) continue;
    if (token.includes("_")) {
      for (const part of token.split("_")) {
        if (part.length >= 2 && !/^\d+$/.test(part) && !STOPWORDS.has(part)) out.push(part);
      }
      continue;
    }
    if (token.includes("/") && token.split("/").some((part) => STOPWORDS.has(part))) continue;
    out.push(token);
  }
  return out;
}

/** term -> occurrence count */
export function termCounts(text: string | null | undefined): Map<string, number> {
  const counts = new Map<string, number>();
  for (const term of extractTerms(text)) {
    counts.set(term, (counts.get(term) ?? 0) + 1);
  }
  return counts;
}

export interface TermCount {
  term: string;
  count: number;
}

/** Sorted by count desc, then term asc. */
export function topTerms(counts: Map<string, number>, { limit = 25, minCount = 1 }: { limit?: number; minCount?: number } = {}): TermCount[] {
  const entries = [...counts.entries()]
    .filter(([, count]) => count >= minCount)
    .map(([term, count]) => ({ term, count }));
  entries.sort((a, b) => b.count - a.count || a.term.localeCompare(b.term));
  return entries.slice(0, limit);
}
