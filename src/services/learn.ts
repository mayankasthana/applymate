import type { Application, Job, PursuitVerdict, Status } from "../domain.ts";
import { PURSUIT_VERDICTS } from "../domain.ts";

/**
 * Self-learning: reads what the candidate actually decided and reports where the
 * match score agrees with them, where it disagrees, and what the data can and
 * cannot support. Strictly advisory — nothing here mutates a score, a verdict or
 * the relevance floor. The candidate's stated bar stays theirs (prime directive 4).
 *
 * The hard part is not computing averages, it is refusing to: with a handful of
 * scored verdicts a mean is noise dressed as insight. So every claim below is
 * gated on sample size and the report says plainly when it cannot conclude.
 */

/** Scored examples per verdict before a band is treated as informative. */
export const CONFIDENT_SAMPLE = 8;

export type Confidence = "low" | "medium" | "high";

export interface VerdictBand {
  verdict: PursuitVerdict;
  /** Verdicts recorded for this band, and how many carry a match score. */
  n: number;
  scored: number;
  scores: number[];
  mean: number | null;
  median: number | null;
  min: number | null;
  max: number | null;
  /** Whether `scored` is large enough for this band to carry weight. */
  informative: boolean;
}

export interface OutcomeFunnel {
  /** Applications that reached `submitted` or beyond. */
  submitted: number;
  /** Reached an interview (`interviewing` or `offer`). */
  interviewed: number;
  /** Converted all the way to an offer. */
  offered: number;
  /** Explicitly rejected. */
  rejected: number;
}

export interface Suggestion {
  kind: "score-more" | "raise-floor" | "lower-floor" | "overlap" | "no-signal" | "cold";
  severity: "info" | "action";
  message: string;
  /** Present on `raise-floor`/`lower-floor`: the number being proposed. */
  value?: number;
  /** Present on `score-more`: application ids still missing a score. */
  appIds?: string[];
}

export interface LearnReport {
  generatedAt: string;
  totals: {
    applications: number;
    verdicts: number;
    scoredVerdicts: number;
    decided: number;
  };
  bands: VerdictBand[];
  /**
   * Region where the score cannot tell a green from a non-green verdict, as a
   * low-high band. Non-null means the score does not decide on its own.
   */
  overlap: { from: number; to: number } | null;
  /**
   * Clean separation, when it exists: every scored green sat at or above
   * `from`, and every scored non-green at or below `to`.
   */
  decisive: { from: number; to: number } | null;
  /** Verdict-only applications that never got a score — the learnable gap. */
  unscored: { count: number; appIds: string[] };
  funnel: { overall: OutcomeFunnel; byVerdict: Partial<Record<PursuitVerdict, OutcomeFunnel>> };
  confidence: Confidence;
  suggestions: Suggestion[];
  /** The floor currently configured, echoed back for context. */
  minMatchScore: number;
}

/** Statuses that count as having reached each rung of the funnel. */
const SUBMITTED_PLUS: ReadonlySet<Status> = new Set<Status>(["submitted", "interviewing", "offer"]);
const INTERVIEWED: ReadonlySet<Status> = new Set<Status>(["interviewing", "offer"]);

function mean(xs: number[]): number | null {
  if (!xs.length) return null;
  return Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10;
}

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : Math.round(((s[mid - 1]! + s[mid]!) / 2) * 10) / 10;
}

function band(verdict: PursuitVerdict, apps: Application[], sampleSize: number): VerdictBand {
  const inBand = apps.filter((a) => a.pursuit?.verdict === verdict);
  const scores = inBand
    .map((a) => a.matchScore)
    .filter((s): s is number => typeof s === "number");
  const scored = scores.length;
  return {
    verdict,
    n: inBand.length,
    scored,
    scores: [...scores].sort((a, b) => a - b),
    mean: mean(scores),
    median: median(scores),
    min: scored ? Math.min(...scores) : null,
    max: scored ? Math.max(...scores) : null,
    informative: scored >= sampleSize,
  };
}

function funnel(apps: Application[]): OutcomeFunnel {
  return {
    submitted: apps.filter((a) => SUBMITTED_PLUS.has(a.status)).length,
    interviewed: apps.filter((a) => INTERVIEWED.has(a.status)).length,
    offered: apps.filter((a) => a.status === "offer").length,
    rejected: apps.filter((a) => a.status === "rejected").length,
  };
}

/**
 * Build the advisory calibration report.
 *
 * `jobs` is only used to label unscored applications with their company, so the
 * "go score these" list is actionable rather than a wall of ids.
 */
export interface LearnOptions {
  jobs?: Job[];
  minMatchScore?: number;
  now?: string;
  sampleSize?: number;
}

export function buildLearnReport(
  applications: Application[],
  { jobs = [], minMatchScore = 0, now = new Date().toISOString(), sampleSize = CONFIDENT_SAMPLE }: LearnOptions = {}
): LearnReport {
  const bands = PURSUIT_VERDICTS.map((v) => band(v, applications, sampleSize));

  const green = bands.find((b) => b.verdict === "green")!;
  const nonGreenScores = bands
    .filter((b) => b.verdict !== "green")
    .flatMap((b) => b.scores);

  // Separation only exists when both sides have scored examples.
  const greenFloor = green.scored ? green.min : null;
  const nonGreenCeiling = nonGreenScores.length ? Math.max(...nonGreenScores) : null;
  let decisive: LearnReport["decisive"] = null;
  let overlap: LearnReport["overlap"] = null;
  if (greenFloor !== null && nonGreenCeiling !== null) {
    if (greenFloor > nonGreenCeiling) decisive = { from: greenFloor, to: nonGreenCeiling };
    // Otherwise the two ranges intersect on [greenFloor, nonGreenCeiling] — the
    // band where the score cannot tell the two verdicts apart.
    else overlap = { from: greenFloor, to: nonGreenCeiling };
  }

  const verdicts = applications.filter((a) => a.pursuit?.verdict);
  const scoredVerdicts = verdicts.filter((a) => typeof a.matchScore === "number");
  const decided = applications.filter((a) => INTERVIEWED.has(a.status) || a.status === "rejected");

  const unscoredApps = verdicts.filter((a) => typeof a.matchScore !== "number");
  const jobById = new Map(jobs.map((j) => [j.id, j]));
  const unscored: LearnReport["unscored"] = {
    count: unscoredApps.length,
    appIds: unscoredApps
      .slice()
      .sort((a, b) => String(a.updatedAt).localeCompare(String(b.updatedAt)))
      .map((a) => {
        const company = jobById.get(a.jobId)?.company;
        return company ? `${a.id} (${company})` : a.id;
      }),
  };

  const byVerdict: LearnReport["funnel"]["byVerdict"] = {};
  for (const v of PURSUIT_VERDICTS) {
    const group = applications.filter((a) => a.pursuit?.verdict === v);
    if (group.length) byVerdict[v] = funnel(group);
  }

  const confidence: Confidence =
    scoredVerdicts.length >= sampleSize * 2 ? "high" : scoredVerdicts.length >= sampleSize ? "medium" : "low";

  const suggestions = suggest({
    bands,
    decisive,
    overlap,
    unscored,
    decided: decided.length,
    verdicts: verdicts.length,
    minMatchScore,
  });

  return {
    generatedAt: now,
    totals: {
      applications: applications.length,
      verdicts: verdicts.length,
      scoredVerdicts: scoredVerdicts.length,
      decided: decided.length,
    },
    bands,
    overlap,
    decisive,
    unscored,
    funnel: { overall: funnel(applications), byVerdict },
    confidence,
    suggestions,
    minMatchScore,
  };
}

function suggest(ctx: {
  bands: VerdictBand[];
  decisive: LearnReport["decisive"];
  overlap: LearnReport["overlap"];
  unscored: LearnReport["unscored"];
  decided: number;
  verdicts: number;
  minMatchScore: number;
}): Suggestion[] {
  const out: Suggestion[] = [];
  const { bands, decisive, overlap, unscored, minMatchScore } = ctx;
  const green = bands.find((b) => b.verdict === "green")!;
  const anyInformative = bands.some((b) => b.informative);

  // The biggest lever is usually data, not thresholds: a verdict that was never
  // scored can never teach the scorer anything.
  if (unscored.count > 0) {
    out.push({
      kind: "score-more",
      severity: "action",
      message:
        `${unscored.count} verdict${unscored.count === 1 ? "" : "s"} carry no match score, ` +
        `so ${unscored.count === 1 ? "it" : "they"} cannot inform calibration. ` +
        `Run \`app match <appId>\` on them to close the gap.`,
      appIds: unscored.appIds,
    });
  }

  // A floor move changes what the relevance gate lets through, so it is only
  // ever proposed from a band big enough to support the claim. Thin data gets
  // reported as a fact, not acted on.
  if (decisive) {
    if (!anyInformative) {
      out.push({
        kind: "cold",
        severity: "info",
        message: `The score separates green from non-green cleanly, but only from too few scored verdicts to trust. Score more before acting.`,
      });
    } else if (decisive.from > minMatchScore) {
      out.push({
        kind: "raise-floor",
        severity: "action",
        message:
          `Every green verdict scored ${decisive.from} or above, and no lower score ever earned one. ` +
          `Your floor sits at ${minMatchScore}.`,
        value: decisive.from,
      });
    } else if (decisive.from < minMatchScore && green.informative) {
      out.push({
        kind: "lower-floor",
        severity: "action",
        message:
          `Green verdicts exist as low as ${decisive.from}, below your floor of ${minMatchScore} — ` +
          `the floor may be rejecting roles you would have pursued.`,
        value: decisive.from,
      });
    }
  }

  if (overlap) {
    out.push({
      kind: "overlap",
      severity: "info",
      message:
        `Scores ${overlap.from}-${overlap.to} earned both green and non-green verdicts. ` +
        `The score alone cannot decide in that band — the company and role gates are doing real work there.`,
    });
  }

  if (!green.scored && ctx.verdicts > 0) {
    out.push({
      kind: "no-signal",
      severity: "info",
      message: "No green verdict has a match score yet, so no threshold can be recommended.",
    });
  }

  if (ctx.decided === 0) {
    out.push({
      kind: "cold",
      severity: "info",
      message: "No application has reached an interview or rejection yet, so outcome data cannot calibrate anything.",
    });
  }

  return out;
}

/** One-line-per-band summary used by the CLI's default rendering. */
export function renderLearnText(r: LearnReport): string {
  const L: string[] = [];
  L.push(`# calibration — confidence: ${r.confidence}`);
  L.push("");
  L.push(
    `${r.totals.verdicts} verdicts, ${r.totals.scoredVerdicts} scored, ` +
      `${r.totals.decided} with a real outcome (floor: ${r.minMatchScore})`
  );
  L.push("");
  L.push("verdict   n     scored   mean   median   range");
  for (const b of r.bands) {
    const range = b.scored ? `${b.min}-${b.max}` : "-";
    const flag = b.informative ? "" : b.scored ? "  (thin)" : "";
    L.push(
      `${b.verdict.padEnd(8)} ${String(b.n).padEnd(5)} ${String(b.scored).padEnd(8)} ` +
        `${String(b.mean ?? "-").padEnd(6)} ${String(b.median ?? "-").padEnd(8)} ${range}${flag}`
    );
  }
  L.push("");
  if (r.decisive) {
    L.push(`score separates verdicts: green >= ${r.decisive.from}, non-green <= ${r.decisive.to}`);
  } else if (r.overlap) {
    L.push(`score does NOT separate verdicts: overlap ${r.overlap.from}-${r.overlap.to}`);
  } else {
    L.push("not enough scored verdicts on both sides to compare yet");
  }
  const f = r.funnel.overall;
  L.push("");
  L.push(`outcomes: ${f.submitted} submitted, ${f.interviewed} interviewed, ${f.offered} offered, ${f.rejected} rejected`);
  if (r.suggestions.length) {
    L.push("");
    L.push("suggestions (advisory — nothing changed):");
    for (const s of r.suggestions) L.push(`  - [${s.severity}] ${s.message}`);
  }
  return L.join("\n");
}