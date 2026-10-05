/**
 * Pay figures for a listing. Every number here is *sourced*, never modelled:
 * either the posting states a range (basis "posted") or a figure was scraped
 * from a comp source the agent opened (basis "sourced"). A listing with no
 * figure has `comp: null` and the board says so — an invented midpoint would
 * be a fabricated fact about a job the candidate is about to apply to.
 *
 * The candidate's own floor (prefs `salaryFloor`, e.g. "60 LPA (INR)") is only
 * ever *compared*, never used as a fallback estimate: guessing "at least your
 * floor" for every listing would make the field useless and untrue.
 */

import { normalizeCompensation, type CompBasis, type CompPeriod, type Compensation } from "../domain.ts";

export { normalizeCompensation as normalizeComp };
export type { CompBasis, CompPeriod, Compensation };

/** A figure found in text, before it is attributed to a source. */
export interface CompCandidate {
  low: number;
  high: number;
  currency: string;
  period: CompPeriod;
  asText: string;
  /** Offset of the matched text in the source, for context display. */
  at: number;
}

// ---------------------------------------------------------------------------
// extraction from posting text
// ---------------------------------------------------------------------------

/** Currency marker before a number. Longest spellings first: "CA$" beats "$". */
const CUR = String.raw`(?:\$|€|£|₹|¥|₩|R\$|US\$|CA\$|C\$|AU\$|A\$|NZ\$|SG\$|HK\$|\b(?:USD|INR|EUR|GBP|CAD|AUD|SGD|JPY|AED|CHF|ZAR|SEK|BRL)\b|\bRs\.?)`;

/** A number, however it is grouped: 140,000 · 45,00,000 · 1.5 · 140 */
const NUM = String.raw`\d[\d,]*(?:\.\d+)?`;

/** An optional magnitude: LPA, lakh, Cr, K, M, B… Longest spellings first, so
 *  "LPA" is never read as a bare "L" with "PA" left over. The trailing \b is
 *  what stops a lone "L" from being read off the start of "Legal". */
const SCALE = String.raw`(?:LPA|lpa|lakhs?|Lakhs?|lacs?|lac|Lakh|lakh|Cr|cr|crores?|Crore|K|k|L|l|M|mn|[Mm]illion|B|bn|[Bb]illion)?\b`;

const RANGE = String.raw`\s*(?:-{1,2}|–|—|to|up to)\s*`;

/** An optional currency marker, before either endpoint. */
const CUR_OPT = String.raw`(?:${CUR}\s*)?`;

/**
 * One shape covers every way postings write pay: a currency, a number, an
 * optional magnitude, and an optional second endpoint with the same options.
 * A range is a real range only when the second number group participates.
 */
const MONEY_RE = new RegExp(
  `${CUR_OPT}(${NUM})\\s*(${SCALE})\\s*(?:${RANGE}${CUR_OPT}(${NUM})\\s*(${SCALE}))?`,
  "g"
);

/** 45,00,000 — every group but the last is two digits. Plain Indian numbering. */
function isIndianGrouping(text: string): boolean {
  if (!text.includes(",")) return false;
  const groups = text.split(",");
  if (groups.length < 3) return false;
  return groups.slice(0, -1).every((g) => g.length === 2) && groups[groups.length - 1]!.length === 3;
}

/** 235.000 — European grouping: three digits per dot-separated group. */
function isDotGrouping(text: string): boolean {
  return /^\d{1,3}(\.\d{3})+$/.test(text);
}

/** Currencies whose postings write 235.000 rather than 235,000. */
const DOT_GROUPED_CURRENCIES = new Set(["EUR", "GBP", "CHF", "SEK", "NOK", "DKK", "PLN", "CZK", "ZAR", "HUF", "RON"]);

/** Scale token -> multiplier. Lakh/crore are South Asian units; K/M/B are not. */
function scaleFactor(token: string): number {
  const t = token.trim();
  if (!t) return 1;
  if (/^(?:crores?|cr)$/i.test(t)) return 10_000_000;
  if (/^(?:lakhs?|lacs?|lpa|l)$/i.test(t)) return 100_000;
  if (/^(?:millions?|mn|m)$/i.test(t)) return 1_000_000;
  if (/^(?:billions?|bn|b)$/i.test(t)) return 1_000_000_000;
  if (/^k$/i.test(t)) return 1_000;
  return 1;
}

/** Lakh/LPA/crore are Indian units; they imply rupees even unmarked. */
function impliesINR(token: string): boolean {
  return /^(?:lakhs?|lacs?|lpa|l|crores?|cr)$/i.test(token.trim());
}

/** Words that make a nearby figure believable as pay. */
const PAY_CONTEXT =
  /(?:salary|salaries|compensation|remuneration|earnings|\bpay\b|ctc|total\s+(?:cash|cost)|packet|package|base|stipend|per\s+annum|per\s+month|per\s+year|\bp\.?a\.?\b|\blpa\b|lakhs?|crores?|pay\s+range|monthly|annually|hourly|per\s+(?:hour|hr)|\brange\b)/i;

/** A figure followed straight by one of these is a count, not a paycheck:
 *  "40,000 employees", "€5k referral bonus", "one-time $500 stipend". */
const NOT_PAY_NEAR =
  /(?:employees|candidates|applicants|users|customers|engineers|developers|people|headcount|vacancies|openings|downloads|installs|locations|countries|acres|seats?|bonuses?|stipends?|grants?|awards?)\b/i;

/** Words that mean a figure anywhere nearby is a company financial. These
 *  disqualify across the whole window, so a JD that merely mentions "our
 *  customers" next to its pay band is not thrown away. */
const NOT_PAY_FAR =
  /(?:raised|funding\s+round|series\s+[a-e]\b|valuation|market\s+cap|\barr\b|revenues?|turnovers?|under\s+administration|ecosystem\s+value|acquisition|acquired|contract\s+value|\bbudgets?\b|\bfunding\b|\binvestors?\b)/i;

/** Sanity bounds on an *annualized* band: below this it is a fee, a bonus or a
 *  stipend; above it, a funding round or a market cap. Pay bands do not live
 *  here, so the figure is dropped rather than shown as something absurd. */
const MIN_ANNUAL = 20_000;
const MAX_ANNUAL = 100_000_000;

/** How much text around a match decides what it means. */
const CONTEXT_WINDOW = 120;

/** Currency marker -> ISO, longest spellings first so "CA$" beats "$". */
const CURRENCY_TABLE: ReadonlyArray<readonly [string, string]> = [
  ["US$", "USD"], ["CA$", "CAD"], ["C$", "CAD"], ["AU$", "AUD"], ["A$", "AUD"],
  ["NZ$", "NZD"], ["SG$", "SGD"], ["HK$", "HKD"], ["R$", "BRL"],
  ["USD", "USD"], ["INR", "INR"], ["EUR", "EUR"], ["GBP", "GBP"], ["CAD", "CAD"],
  ["AUD", "AUD"], ["SGD", "SGD"], ["JPY", "JPY"], ["AED", "AED"], ["CHF", "CHF"],
  ["ZAR", "ZAR"], ["SEK", "SEK"], ["BRL", "BRL"], ["Rs.", "INR"], ["Rs", "INR"],
  ["$", "USD"], ["€", "EUR"], ["£", "GBP"], ["₹", "INR"], ["¥", "JPY"], ["₩", "KRW"],
];

/** The currency named inside the matched text itself. */
function currencyIn(raw: string): string | null {
  const lower = raw.toLowerCase();
  for (const [token, code] of CURRENCY_TABLE) {
    const i = lower.indexOf(token.toLowerCase());
    if (i !== -1) return code;
  }
  return null;
}

function periodAt(text: string, index: number): CompPeriod {
  const around = `${text.slice(Math.max(0, index - 60), index)} ${text.slice(index, index + 140)}`.toLowerCase();
  if (/\b(?:per\s*(?:hour|hr)|hourly|\/hr\b|an?\s*hour)/.test(around)) return "hour";
  if (/\b(?:per\s*month|monthly|\/mo\b|a\s*month)/.test(around)) return "month";
  return "year";
}

function isYearish(n: number): boolean {
  return Number.isInteger(n) && n >= 1980 && n <= 2035;
}

/** Strip whatever separators this currency's postings use: 45,00,000 · 235.000. */
function parseNumber(raw: string, currency: string): number {
  if (DOT_GROUPED_CURRENCIES.has(currency) && isDotGrouping(raw)) return Number(raw.replace(/\./g, ""));
  return Number(raw.replace(/,/g, ""));
}

/**
 * Pull every pay figure out of posting text. A figure qualifies when it is
 * currency-marked, carries a K/L/Cr magnitude, or uses Indian digit grouping
 * — and the surrounding text has to talk about pay. That is what keeps
 * "raised $50M Series B" and "40,000 employees" out. An unmarked K/M figure has
 * no attributable currency and is dropped rather than guessed. Returns nothing
 * rather than a guess when the text carries no figure at all.
 */
export function parseCompensations(text: string): CompCandidate[] {
  const source = String(text ?? "");
  if (!source.trim()) return [];
  const found: CompCandidate[] = [];

  for (const m of source.matchAll(MONEY_RE)) {
    const raw = m[0];
    const at = m.index ?? 0;
    const firstNumber = m[1]!;
    const firstScale = m[2] ?? "";
    const secondNumber = m[3];
    const secondScale = m[4] ?? "";

    const marked = currencyIn(raw) !== null;
    const scaled = scaleFactor(firstScale) > 1 || scaleFactor(secondScale) > 1;
    const indian = isIndianGrouping(firstNumber) || isIndianGrouping(secondNumber ?? "");
    // A bare number with no currency, magnitude or Indian grouping is not pay.
    if (!marked && !scaled && !indian) continue;

    const context =
      source.slice(Math.max(0, at - CONTEXT_WINDOW), at) +
      " " +
      raw +
      " " +
      source.slice(at + raw.length, at + raw.length + CONTEXT_WINDOW);
    // A spelled-out currency is itself a statement of intent; a bare magnitude
    // or Indian-grouped figure has to be next to pay words to count.
    if (!marked && !PAY_CONTEXT.test(context)) continue;
    if (NOT_PAY_FAR.test(context)) continue;
    const after = source.slice(at + raw.length, at + raw.length + 40);
    if (NOT_PAY_NEAR.test(after)) continue;
    if (/^\s*%/.test(after)) continue;

    const currency = currencyIn(raw) ?? (impliesINR(firstScale || secondScale) || indian ? "INR" : null);
    if (!currency) continue;

    const lo = parseNumber(firstNumber, currency);
    const hi = secondNumber ? parseNumber(secondNumber, currency) : lo;
    if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo <= 0 || hi <= 0) continue;
    if (secondNumber && isYearish(lo) && isYearish(hi)) continue;

    // Each endpoint carries its own magnitude ("$140K - $210K"), and one written
    // after a single number covers that figure ("60 LPA", "45L"). Indian
    // grouping needs no magnitude at all.
    const f1 = scaleFactor(firstScale);
    const f2 = scaleFactor(secondScale);
    let low = Math.round(lo * f1);
    let high = Math.round(hi * (secondNumber ? f2 : f1));
    if (high < low) [low, high] = [high, low];

    // A band that annualizes to a fee, a bonus or a market cap is not a band.
    const period = periodAt(source, at);
    const factor = period === "month" ? 12 : period === "hour" ? 2080 : 1;
    if (low * factor < MIN_ANNUAL || high * factor > MAX_ANNUAL) continue;

    found.push({
      low,
      high,
      currency,
      period: periodAt(source, at),
      asText: raw.trim().replace(/\s+/g, " "),
      at,
    });
  }

  // One figure per spot: a range and either of its endpoints must not both count.
  const kept: CompCandidate[] = [];
  for (const c of found.sort((a, b) => a.at - b.at)) {
    const overlaps = kept.some((k) => c.at < k.at + k.asText.length && k.at < c.at + c.asText.length);
    if (!overlaps) kept.push(c);
  }
  return kept;
}

/** Attach provenance to an extracted candidate. */
export function recordFromCandidate(
  candidate: CompCandidate,
  {
    basis,
    sourceUrl = null,
    sourceName = null,
    note = null,
    now = new Date().toISOString(),
  }: {
    basis: CompBasis;
    sourceUrl?: string | null;
    sourceName?: string | null;
    note?: string | null;
    now?: string;
  }
): Compensation | null {
  return normalizeCompensation({ ...candidate, basis, sourceUrl, sourceName, note, fetchedAt: now });
}

// ---------------------------------------------------------------------------
// formatting
// ---------------------------------------------------------------------------

const SYMBOLS: Record<string, string> = {
  USD: "$", CAD: "CA$", AUD: "A$", NZD: "NZ$", SGD: "S$", INR: "₹",
  EUR: "€", GBP: "£", JPY: "¥", KRW: "₩",
};

const PERIOD_SUFFIX: Record<CompPeriod, string> = { year: "", month: "/mo", hour: "/hr" };

/** Indian digit grouping: 45,00,000, not 4,500,000. */
export function formatIndian(n: number): string {
  const whole = Math.trunc(n);
  const head = String(Math.trunc(whole / 1000));
  const tail = String(whole % 1000).padStart(3, "0");
  return `${head.replace(/\B(?=(\d{2})+(?!\d))/g, ",")},${tail}`;
}

/** The magnitude an amount is best read in: ₹94.2L, $140K, €1.4M. */
function unitFor(amount: number, currency: string): { div: number; unit: string } {
  if (currency === "INR") {
    if (amount >= 1e7) return { div: 1e7, unit: "Cr" };
    if (amount >= 1e5) return { div: 1e5, unit: "L" };
    return { div: 1, unit: "" };
  }
  if (amount >= 1e6) return { div: 1e6, unit: "M" };
  if (amount >= 1e3) return { div: 1e3, unit: "K" };
  return { div: 1, unit: "" };
}

function trim(n: number): string {
  return n.toFixed(n % 1 === 0 ? 0 : 1);
}

/** One figure in the reader's own notation. */
export function formatAmount(amount: number, currency: string): string {
  const sym = SYMBOLS[currency] ?? `${currency} `;
  const { div, unit } = unitFor(amount, currency);
  if (div === 1) return `${sym}${currency === "INR" ? formatIndian(amount) : amount}`;
  return `${sym}${trim(amount / div)}${unit}`;
}

/** A compact one-line figure for a card pill. */
export function formatCompensation(comp: Compensation): string {
  const { low, high, currency, period } = comp;
  const sym = SYMBOLS[currency] ?? `${currency} `;
  const a = unitFor(low, currency);
  const b = unitFor(high, currency);
  const body =
    low === high
      ? formatAmount(low, currency)
      : a.div === b.div
        ? `${sym}${trim(low / a.div)}–${trim(high / b.div)}${b.unit}`
        : `${formatAmount(low, currency)}–${formatAmount(high, currency)}`;
  return body + PERIOD_SUFFIX[period];
}

/** Year-equivalent figures so monthly and hourly postings can be compared. */
export function annualized(comp: Compensation): { low: number; high: number } {
  const factor = comp.period === "month" ? 12 : comp.period === "hour" ? 2080 : 1;
  return { low: comp.low * factor, high: comp.high * factor };
}

export function compMidpoint(comp: Compensation): number {
  const { low, high } = annualized(comp);
  return (low + high) / 2;
}

/** Full sentence for a card hover and the application sheet. */
export function describeComp(comp: Compensation): string {
  const where =
    comp.basis === "posted"
      ? "stated in the posting"
      : comp.basis === "stated"
        ? `stated by ${comp.sourceName ?? "a contact"}`
        : `scraped from ${comp.sourceName ?? comp.sourceUrl}`;
  return `${comp.asText} — ${where} (recorded ${comp.fetchedAt.slice(0, 10)})${comp.note ? ` — ${comp.note}` : ""}`;
}

// ---------------------------------------------------------------------------
// the candidate's floor
// ---------------------------------------------------------------------------

export interface SalaryFloor {
  amount: number;
  currency: string | null;
  asText: string;
}

/**
 * Read the candidate's own `salaryFloor` preference ("60 LPA (INR)", "$150k").
 * Returns null when it carries no number — never a default.
 */
export function parseFloor(preference: unknown): SalaryFloor | null {
  const asText = typeof preference === "string" ? preference.trim() : "";
  if (!asText) return null;
  const saysInr = /\b(?:inr|₹|rs\.?)\b/i.test(asText);
  const candidates = parseCompensations(asText);
  if (!candidates.length) return null;
  const hit = (saysInr ? candidates.find((c) => c.currency === "INR") : null) ?? candidates[0]!;
  return { amount: hit.low, currency: hit.currency, asText };
}

export type FloorVerdict = "below" | "at-or-above" | "unknown" | "no-floor";

/** Compare a figure to the floor. Different currencies are never ranked. */
export function compareToFloor(comp: Compensation, floor: SalaryFloor | null): FloorVerdict {
  if (!floor || !floor.currency) return "no-floor";
  if (floor.currency !== comp.currency) return "unknown";
  return annualized(comp).high >= floor.amount ? "at-or-above" : "below";
}

/**
 * What a card shows about pay, computed once on the server. The review UI is a
 * static string and cannot import this module, so formatting lives here rather
 * than being reimplemented in the page and drifting from the CLI's.
 */
export interface PayDisplay {
  label: string;
  title: string;
  verdict: FloorVerdict | "none";
  basis: CompBasis | null;
  url: string | null;
}

export function payDisplay(comp: Compensation | null, floor: SalaryFloor | null): PayDisplay {
  if (!comp) {
    return {
      label: "no pay figure",
      title: "no pay figure on file — open the card and ask Aja to pull one from a source",
      verdict: "none",
      basis: null,
      url: null,
    };
  }
  const verdict = compareToFloor(comp, floor);
  let title = describeComp(comp);
  if (floor?.currency) {
    title +=
      verdict === "below"
        ? ` — under your floor of ${floor.asText}`
        : verdict === "at-or-above"
          ? ` — clears your floor of ${floor.asText}`
          : ` — ${comp.currency}, so it is not ranked against your ${floor.currency} floor of ${floor.asText}`;
  }
  return { label: formatCompensation(comp), title, verdict, basis: comp.basis, url: comp.sourceUrl };
}