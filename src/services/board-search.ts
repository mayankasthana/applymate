import type { Status } from "../domain.ts";
import type { AppSummary } from "./pipeline.ts";

export type Board = Record<Status, AppSummary[]>;

/**
 * The board search box: filter cards by req number (lives in the posting
 * URL), company, title, match score, application id, or pursuit note — any
 * free text, case-insensitive. Multiple terms AND together, so
 * "walmart staff" only keeps cards matching both.
 */
export function filterBoard(board: Board, query: string | null | undefined): Board {
  const tokens = String(query ?? "").trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return board;
  const out = {} as Board;
  for (const [status, cards] of Object.entries(board) as [Status, AppSummary[]][]) {
    out[status] = cards.filter((card) => {
      const haystack = [
        card.id,
        card.jobId,
        card.company,
        card.title,
        card.status,
        card.matchScore,
        card.pursuit?.verdict,
        card.pursuit?.note,
        card.jobUrl,
      ]
        .filter((v) => v !== null && v !== undefined)
        .join("\n")
        .toLowerCase();
      return tokens.every((t) => haystack.includes(t.toLowerCase()));
    });
  }
  return out;
}
