import type { Status, PursuitVerdict } from "../domain.ts";
import { filterBoard, type Board } from "./board-search.ts";
import { compareToFloor, compMidpoint, type Compensation, type SalaryFloor } from "./comp.ts";
import type { AppSummary } from "./pipeline.ts";

/** How cards are ordered inside their lane. */
export const SORT_KEYS = ["recent", "score", "company", "pay"] as const;
export type SortKey = (typeof SORT_KEYS)[number];

export function isSortKey(value: unknown): value is SortKey {
  return typeof value === "string" && (SORT_KEYS as readonly string[]).includes(value);
}

/** The pursuit filter also has to be able to select cards with no verdict. */
export const PURSUIT_FILTERS = ["green", "amber", "red", "none"] as const;
export type PursuitFilter = (typeof PURSUIT_FILTERS)[number];

/** "below-floor" needs the candidate's own floor to compare against. */
export const PAY_FILTERS = ["any", "with", "without", "below-floor"] as const;
export type PayFilter = (typeof PAY_FILTERS)[number];

export interface BoardView {
  /** Free text: req id, company, role, any term (AND together). */
  query?: string | null;
  /** Hide cards scoring below this. Unscored cards have no score to compare. */
  minScore?: number | null;
  pursuit?: PursuitFilter | null;
  /** Which lanes to keep; null or empty means every lane. */
  stages?: Status[] | null;
  pay?: PayFilter | null;
  sort?: SortKey | null;
  /** Only used by the below-floor filter. */
  floor?: SalaryFloor | null;
}

const byRecency = (a: AppSummary, b: AppSummary) =>
  String(b.updatedAt).localeCompare(String(a.updatedAt)) || a.id.localeCompare(b.id);

const byScore = (a: AppSummary, b: AppSummary) =>
  (b.matchScore ?? -1) - (a.matchScore ?? -1) || a.id.localeCompare(b.id);

const byCompany = (a: AppSummary, b: AppSummary) =>
  a.company.localeCompare(b.company) || a.title.localeCompare(b.title) || a.id.localeCompare(b.id);

/**
 * Pay sorts by annualized midpoint, but only *within* a currency: ranking a
 * dollar band against a rupee band would need an exchange rate nobody here has,
 * so currencies stay grouped and alphabetical instead.
 */
const byPay = (a: AppSummary, b: AppSummary) => {
  if (!a.comp && !b.comp) return byScore(a, b);
  if (!a.comp) return 1;
  if (!b.comp) return -1;
  return a.comp.currency.localeCompare(b.comp.currency) || compMidpoint(b.comp) - compMidpoint(a.comp) || a.id.localeCompare(b.id);
};

const COMPARATORS: Record<SortKey, (a: AppSummary, b: AppSummary) => number> = {
  recent: byRecency,
  score: byScore,
  company: byCompany,
  pay: byPay,
};

function payMatches(comp: Compensation | null, filter: PayFilter, floor: SalaryFloor | null): boolean {
  if (filter === "with") return comp !== null;
  if (filter === "without") return comp === null;
  if (filter === "below-floor") return comp !== null && compareToFloor(comp, floor) === "below";
  return true;
}

/**
 * The board as the candidate asked to see it: the free-text search, then the
 * filters (all of which must pass), then an ordering inside each lane. Lanes
 * themselves never move — a card's column is its status, and that is the
 * candidate's call, not a sort.
 */
export function viewBoard(board: Board, view: BoardView = {}): Board {
  const filtered = filterBoard(board, view.query);
  // Zero is the slider's "off" position, not "hide everything unscored": at the
  // floor of the control the board shows what it always showed.
  const minScore =
    typeof view.minScore === "number" && Number.isFinite(view.minScore) && view.minScore > 0 ? view.minScore : null;
  const stages = view.stages?.length ? new Set(view.stages) : null;
  const pay = view.pay && view.pay !== "any" ? view.pay : null;

  const out = {} as Board;
  for (const [status, cards] of Object.entries(filtered) as [Status, AppSummary[]][]) {
    const kept = cards.filter((card) => {
      if (stages && !stages.has(status)) return false;
      if (minScore !== null && (card.matchScore === null || card.matchScore < minScore)) return false;
      if (view.pursuit === "none" && card.pursuit !== null) return false;
      if (view.pursuit && view.pursuit !== "none" && card.pursuit?.verdict !== view.pursuit) return false;
      if (pay && !payMatches(card.comp ?? null, pay, view.floor ?? null)) return false;
      return true;
    });
    out[status] = [...kept].sort(COMPARATORS[view.sort ?? "recent"]);
  }
  return out;
}

/** How many cards survive a view, for the "showing N of M" line. */
export function countBoard(board: Board): number {
  return (Object.values(board) as AppSummary[][]).reduce((n, cards) => n + cards.length, 0);
}

/**
 * Read a view off query parameters. Unknown, empty or out-of-range values are
 * ignored rather than refused: a stale bookmark narrows nothing instead of
 * producing an error the candidate has to clear by hand.
 */
export function parseBoardView(params: URLSearchParams | Record<string, string | undefined>): BoardView {
  const get = (key: string): string | null =>
    params instanceof URLSearchParams ? params.get(key) : params[key] ?? null;

  const rawScore = get("minScore");
  const score = rawScore === null ? null : Number(rawScore);
  const minScore = score !== null && Number.isFinite(score) ? Math.max(0, Math.min(100, score)) : null;

  const pursuit = PURSUIT_FILTERS.includes(get("pursuit") as PursuitFilter) ? (get("pursuit") as PursuitFilter) : null;
  const pay = PAY_FILTERS.includes(get("pay") as PayFilter) ? (get("pay") as PayFilter) : null;
  const sort = isSortKey(get("sort")) ? (get("sort") as SortKey) : null;

  const stages = (get("status") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean) as Status[];

  return {
    query: get("q") ?? null,
    minScore,
    pursuit,
    stages: stages.length ? stages : null,
    pay,
    sort,
  };
}