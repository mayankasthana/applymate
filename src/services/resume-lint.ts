import { readdir, readFile } from "node:fs/promises";
import { basename, join } from "node:path";

import type { Application, Job } from "../domain.ts";
import type { Collection } from "../adapters/json-collection.ts";
import type { OutreachService } from "./outreach.ts";
import { referralCounts } from "./outreach.ts";

export type LintSeverity = "error" | "warn";

export type LintRuleId =
  // markdown meta-line rules (the ones portal resume parsers read)
  | "meta-line-title-joined"
  | "meta-line-company-decorated"
  | "meta-line-date-on-heading"
  | "meta-line-date-malformed"
  // document-level
  | "target-company-named"
  | "summary-too-long"
  | "resume-too-long"
  // filenames that leave the machine
  | "filename-not-generic"
  | "filename-names-company"
  | "filename-names-other-company"
  // bookkeeping that produces cross-application leaks
  | "artifact-foreign-dir"
  // cross-variant consistency
  | "fact-drift"
  // company-level strategy
  | "company-multi-resume"
  | "referral-collision";

interface RuleSpec {
  severity: LintSeverity;
  summary: string;
  hint: string;
}

/**
 * The rule table is the single source of truth for severity, the human-readable
 * summary `docs/` and the note quote from, and the wording of `--help`. Keeping
 * it as data (rather than an `if` per call site) is what lets the same engine
 * report a hard `error` at the pre-portal gate and a softer `warn` at draft time.
 */
export const RULES: Readonly<Record<LintRuleId, RuleSpec>> = Object.freeze({
  "meta-line-title-joined": {
    severity: "error",
    summary: "two or more job titles share one line",
    hint: "one title per line, alone, then the date range alone on the next line",
  },
  "meta-line-company-decorated": {
    severity: "error",
    summary: "employer heading carries parentheses or a sub-brand",
    hint: "company line is plain text `Company, City, Country`",
  },
  "meta-line-date-on-heading": {
    severity: "error",
    summary: "date range sits on the employer heading line",
    hint: "the date range gets its own line, exactly `MMM YYYY – MMM YYYY`",
  },
  "meta-line-date-malformed": {
    severity: "error",
    summary: "date line is not exactly `MMM YYYY – MMM YYYY`",
    hint: "en dash, `MMM YYYY` on both ends, no inline notes",
  },
  "target-company-named": {
    severity: "error",
    summary: "resume names the target company",
    hint: "tailor the content, keep the document generic; the cover letter names the company",
  },
  "summary-too-long": {
    severity: "warn",
    summary: "summary is long enough that a 6-second glance will not finish it",
    hint: "three lines: scale, domain, the one thing to remember",
  },
  "resume-too-long": {
    severity: "warn",
    summary: "document runs past the 2-page A4 budget",
    hint: "cut narrative, not facts — lead with the numbers, spend the body on substance",
  },
  "filename-not-generic": {
    severity: "error",
    summary: "uploaded file is not named for the candidate alone",
    hint: "portals show the filename to recruiters; per-company copies stay in the dossier",
  },
  "filename-names-company": {
    severity: "error",
    summary: "filename names the company being applied to",
    hint: "that advertises the tailoring to the exact person reading it",
  },
  "filename-names-other-company": {
    severity: "error",
    summary: "filename names a different company than the one applied to",
    hint: "a stale or mis-registered upload — re-check which file actually went to the portal",
  },
  "artifact-foreign-dir": {
    severity: "error",
    summary: "artifact points into another application's directory",
    hint: "each application owns its files; a shared path is how the wrong resume gets sent",
  },
  "fact-drift": {
    severity: "error",
    summary: "a role or date disagrees with the other tailored variants",
    hint: "two resumes from one person must not tell the same recruiter different dates",
  },
  "company-multi-resume": {
    severity: "warn",
    summary: "several different resumes went to one company on one day",
    hint: "one resume per company, reused across that company's roles",
  },
  "referral-collision": {
    severity: "warn",
    summary: "multiple applications at a company that has a live referral",
    hint: "let the referral make the internal intro; do not compete with yourself",
  },
});

export interface LintFinding {
  rule: LintRuleId;
  severity: LintSeverity;
  message: string;
  hint: string;
}

export interface LintReport {
  appId: string;
  company: string;
  findings: LintFinding[];
}

export function errorsIn(report: LintReport): LintFinding[] {
  return report.findings.filter((f) => f.severity === "error");
}

export const DEFAULTS = {
  summaryWords: 80,
  resumeWords: 1000,
} as const;

// ---------------------------------------------------------------------------
// markdown rules
// ---------------------------------------------------------------------------

export interface MarkdownLintOptions {
  /** The company this resume is being tailored for; caught if named in the body. */
  targetCompany?: string | null;
  maxSummaryWords?: number;
  maxResumeWords?: number;
}

// Grouped: this is interpolated into alternations, where a bare `a|b|c` would
// bind its suffix to only the last alternative.
const MONTHS = "(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)";
/** The one date shape portal parsers accept. `Present` is allowed as the end. */
const CANONICAL_DATE = new RegExp(`^(?:[A-Z][a-z]{2} \\d{4}|Present) – (?:[A-Z][a-z]{2} \\d{4}|Present)$`);
const EMPLOYER_SECTION = /^#{1,2}\s+(experience|work experience|professional experience|employment|employment history)\b/i;

/**
 * A line that OPENS with a date range. Anchoring at the start is what keeps
 * ordinary bullets out: a bullet legitimately mentions a year ("1st place
 * (Dec 2023)") and flagging it would bury the real findings under noise. A
 * genuinely malformed date line starts with the date.
 */
const MALFORMED_DATE_LINE = new RegExp(
  `^(?![-*+>|·\\s])(?:${MONTHS}\\s+\\d{4}|${MONTHS})\\s*[-–—]\\s*(?:${MONTHS}\\s+\\d{4}|${MONTHS}\\s+\\d{2})\\b`,
);

/** Words that mark a bold span as a job title rather than a metric or a project. */
const TITLE_WORD =
  /\b(engineer|architect|developer|manager|director|consultant|scientist|analyst|lead|principal|senior|staff|intern|head)\b/i;

/**
 * `**Principal** (2022 – 2026) · **Lead** (2017 – 2022)` — several titles joined
 * on one line. Splitting on the separator and asking each side for a title-shaped
 * bold span is what separates this from a bullet that merely uses bold.
 */
function joinedTitleLine(text: string): boolean {
  if (!/[·;,]/.test(text)) return false;
  return text
    .split(/[·;,]/)
    .filter((segment) =>
      [...segment.matchAll(/\*\*([^*\n]+)\*\*/g)].some((m) => TITLE_WORD.test(m[1] ?? "")),
    ).length >= 2;
}

function stripMarkdown(line: string): string {
  return line.replace(/[*_`#>]/g, "").trim();
}

function words(text: string): string[] {
  return text.split(/\s+/).filter(Boolean);
}

/** Split into lines tagged with their heading level so we can scope the rules. */
function headingLevel(line: string): number {
  const m = /^#{1,6}\s/.exec(line);
  return m ? m[0].trimEnd().length : 0;
}

/** `Nimbus Data Systems, Pune, India` — a parser-safe employer line, unadorned. */
const PLAIN_EMPLOYER = /^(?!\s)(?![-*+>#|])[A-Z][^\n]{0,80},[^\n]{1,40}$/;

/**
 * Walk the experience section, tracking the current employer line so the
 * meta-line rules only fire on employer blocks — a heading like
 * `## Selected technical breadth (optional)` must not trip the parens rule.
 *
 * Both employer shapes count: a `### Company, City, Country` heading, and the
 * plain unadorned line the standards note actually mandates. Recognising only
 * the heading form would hide the ATS-safe format from the fact checker, which
 * is precisely where date disagreements need to be caught.
 */
function experienceLines(md: string): { line: string; index: number; isEmployer: boolean }[] {
  const lines = md.split("\n");
  let inSection = false;
  let sectionLevel = 0;
  const out: { line: string; index: number; isEmployer: boolean }[] = [];
  lines.forEach((line, index) => {
    const level = headingLevel(line);
    if (level > 0 && level <= 2) {
      if (EMPLOYER_SECTION.test(line)) {
        inSection = true;
        sectionLevel = level;
        return;
      }
      if (inSection && level <= sectionLevel) {
        inSection = false;
        return;
      }
    }
    if (!inSection) return;
    const isHeadingEmployer = level === 3 || level === 2;
    const isPlainEmployer = !isHeadingEmployer && PLAIN_EMPLOYER.test(line.trim()) && !line.includes("**");
    out.push({ line, index, isEmployer: isHeadingEmployer || isPlainEmployer });
  });
  return out;
}

export function lintResumeMarkdown(md: string, opts: MarkdownLintOptions = {}): LintFinding[] {
  const maxSummary = opts.maxSummaryWords ?? DEFAULTS.summaryWords;
  const maxWords = opts.maxResumeWords ?? DEFAULTS.resumeWords;
  const findings: LintFinding[] = [];
  const push = (rule: LintRuleId, message: string) => {
    const spec = RULES[rule];
    findings.push({ rule, severity: spec.severity, message, hint: spec.hint });
  };

  for (const { line, index, isEmployer } of experienceLines(md)) {
    const text = line.trim();
    if (!text) continue;

    if (isEmployer) {
      const plain = stripMarkdown(text);
      if (plain.includes("(")) {
        push("meta-line-company-decorated", `line ${index + 1}: employer heading has parentheses — "${plain}"`);
      }
      if (text.includes("|")) {
        push("meta-line-date-on-heading", `line ${index + 1}: employer heading pipes a date — "${plain}"`);
      } else if (MALFORMED_DATE_LINE.test(plain) || /\b\d{4}\b/.test(plain)) {
        push("meta-line-date-on-heading", `line ${index + 1}: employer heading carries a date range — "${plain}"`);
      }
    }

    if (joinedTitleLine(text)) {
      push("meta-line-title-joined", `line ${index + 1}: multiple titles on one line — "${stripMarkdown(text).slice(0, 90)}"`);
    }

    // Heading lines are skipped: `meta-line-date-on-heading` already reported those.
    const plain = stripMarkdown(text);
    if (!isEmployer && MALFORMED_DATE_LINE.test(plain) && !CANONICAL_DATE.test(plain)) {
      push("meta-line-date-malformed", `line ${index + 1}: "${plain.slice(0, 90)}" is not \`MMM YYYY – MMM YYYY\``);
    }
  }

  const summary = sectionBody(md, /^#{1,3}\s+summary\b/i);
  const summaryCount = words(stripMarkdown(summary)).length;
  if (summaryCount > maxSummary) {
    push("summary-too-long", `summary is ${summaryCount} words (budget ${maxSummary})`);
  }

  const total = words(stripMarkdown(md.replace(/^#{1,6}\s.*$/gm, ""))).length;
  if (total > maxWords) {
    push("resume-too-long", `${total} words (budget ${maxWords}, roughly 2 A4 pages at 9-10pt)`);
  }

  const target = opts.targetCompany?.trim();
  if (target) findings.push(...targetCompanyFindings(md, target));

  return findings;
}

function sectionBody(md: string, heading: RegExp): string {
  const lines = md.split("\n");
  const start = lines.findIndex((l) => heading.test(l));
  if (start < 0) return "";
  const level = headingLevel(lines[start] ?? "");
  const out: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const l = headingLevel(line);
    if (l > 0 && l <= level) break;
    out.push(line);
  }
  return out.join("\n");
}

/** Normalise to a token the body can be searched for: `HDFC Bank` -> `hdfc bank`. */
export function normalizeCompany(name: string): string {
  return name
    .toLowerCase()
    .replace(/\b(inc|llc|ltd|limited|corp|corporation|co|company|technologies|technology|labs|group|holdings)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function targetCompanyFindings(md: string, company: string): LintFinding[] {
  const spec = RULES["target-company-named"];
  const finding = (message: string): LintFinding => ({
    rule: "target-company-named",
    severity: spec.severity,
    message,
    hint: spec.hint,
  });

  const needle = normalizeCompany(company);
  if (!needle || needle.length < 3) return [];

  // A company the candidate already worked for is legitimately named on the
  // resume — re-applying to a former employer must not read as a violation.
  const ownEmployers = new Set(
    experienceLines(md)
      .filter((l) => l.isEmployer)
      .map((l) => normalizeCompany(employerName(l.line))),
  );
  if (ownEmployers.has(needle)) return [];

  const lines = md.split("\n");
  // Word-bounded: a 3-letter company name (Arm) must not match inside a
  // longer word (warm, swarm), while still catching it mid-prose.
  const pattern = new RegExp(`\\b${needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (headingLevel(line) > 0) continue;
    if (pattern.test(normalizeCompany(line))) {
      return [finding(`line ${i + 1} names the target company "${company}"`)];
    }
  }
  return [];
}

// ---------------------------------------------------------------------------
// employment facts (cross-variant agreement)
// ---------------------------------------------------------------------------

export interface EmploymentFact {
  employer: string;
  title: string;
  start: string;
  end: string;
}

const TITLE_LINE = /^\*\*(.+?)\*\*$/;
/** Every `**Title** (dates)` pair on a line, joined titles included. */
const INLINE_TITLE = /\*\*([^*\n]+)\*\*\s*\(([^)]+)\)/g;
const PARSED_DATE = new RegExp(`^(?:[A-Z][a-z]{2} \\d{4}|Present) – (?:[A-Z][a-z]{2} \\d{4}|Present)$`);

/**
 * Pull `employer / title / start / end` out of a resume. Titles may sit on
 * their own line with the range below, or carry the range inline — both shapes
 * are read so a variant is not silently treated as factless.
 */
const COMPLETE_DATE = /^(?:[A-Z][a-z]{2} \d{4}|Present)$/;

/**
 * `"Jun 2012 – Sep 2016"` -> `{start, end}`. Either dash is accepted, because a
 * hyphen is a formatting fault (reported by `meta-line-date-malformed`) and must
 * not also hide a genuine date disagreement. Both ends must still be complete:
 * a bare `Apr` is incomplete rather than different, so it is left to the
 * formatting rule instead of producing a confusing drift report.
 */
function splitRange(range: string): { start: string; end: string } | null {
  const parts = range.split(/ – | - /).map((p) => p.trim());
  if (parts.length !== 2) return null;
  const [start, end] = parts;
  if (start === undefined || end === undefined) return null;
  if (!COMPLETE_DATE.test(start) || !COMPLETE_DATE.test(end)) return null;
  return { start, end };
}

/**
 * Reduce an employer line to the company name alone, so the same employer keys
 * identically whether it was written as a decorated heading
 * (`### Nimbus Data Systems (NewsRadar) - Bengaluru, India`) or in the plain
 * parser-safe form (`Nimbus Data Systems, Pune, India`). Without this the two
 * shapes produce different keys and a date disagreement is never compared.
 */
export function employerName(line: string): string {
  return stripMarkdown(line)
    .replace(/\s*\([^)]*\)\s*/g, " ")
    .replace(/\s*[*_]+\s*/g, " ")
    .split(/[|,]|\s+[–-]\s+/)[0]
    ?.trim() ?? "";
}

/** The next non-empty, markdown-stripped line at or after `from`. */
function nextNonBlank(lines: { line: string }[], from: number): string | null {
  for (let i = from; i < lines.length; i++) {
    const text = stripMarkdown(lines[i]?.line ?? "").trim();
    if (text) return text;
  }
  return null;
}

export function extractEmploymentFacts(md: string): EmploymentFact[] {
  const lines = experienceLines(md);
  const facts: EmploymentFact[] = [];
  let employer = "";

  for (let i = 0; i < lines.length; i++) {
    const entry = lines[i];
    if (!entry) continue;
    const { line, isEmployer } = entry;
    const text = line.trim();
    if (!text) continue;

    if (isEmployer) {
      employer = employerName(text);
      continue;
    }
    // Read every title on the line, joined ones included: a compressed block is
    // exactly where a wrong date hides, so the fact check must still see them.
    const inline = [...text.matchAll(INLINE_TITLE)];
    if (inline.length) {
      for (const match of inline) {
        const title = match[1]?.trim();
        const parsed = splitRange(match[2]?.trim() ?? "");
        if (parsed && title && employer) facts.push({ employer, title, ...parsed });
      }
      continue;
    }
    const bare = TITLE_LINE.exec(text);
    const title = bare?.[1]?.trim();
    if (!title) continue;
    // The date sits below the title, usually after a blank line.
    const next = nextNonBlank(lines, i + 1);
    const parsed = next === null ? null : splitRange(next);
    if (parsed && PARSED_DATE.test(next ?? "") && employer) {
      facts.push({ employer, title, ...parsed });
    }
  }
  return facts;
}

export function factKey(f: EmploymentFact): string {
  return `${normalizeCompany(f.employer)} :: ${f.title.toLowerCase()}`;
}

/**
 * The baseline is the value most tailored variants agree on. The candidate does
 * not hand-maintain a dates file: 15 of 16 variants agreeing makes the
 * consensus exact, and the lone dissenter is precisely the outlier worth flagging.
 */
export function baselineFacts(all: EmploymentFact[][]): Map<string, EmploymentFact> {
  const tally = new Map<string, Map<string, { fact: EmploymentFact; count: number }>>();
  for (const variant of all) {
    for (const fact of variant) {
      const key = factKey(fact);
      if (!tally.has(key)) tally.set(key, new Map());
      const bucket = tally.get(key)!;
      const value = `${fact.start} – ${fact.end}`;
      const existing = bucket.get(value);
      if (existing) existing.count += 1;
      else bucket.set(value, { fact: { ...fact }, count: 1 });
    }
  }
  const baseline = new Map<string, EmploymentFact>();
  for (const [key, bucket] of tally) {
    let best: { fact: EmploymentFact; count: number } | null = null;
    for (const entry of bucket.values()) {
      if (!best || entry.count > best.count) best = entry;
    }
    if (best) baseline.set(key, best.fact);
  }
  return baseline;
}

export function factDrift(facts: EmploymentFact[], baseline: Map<string, EmploymentFact>): LintFinding[] {
  const spec = RULES["fact-drift"];
  const out: LintFinding[] = [];
  for (const fact of facts) {
    const agreed = baseline.get(factKey(fact));
    if (!agreed) continue;
    if (agreed.start === fact.start && agreed.end === fact.end) continue;
    out.push({
      rule: "fact-drift",
      severity: spec.severity,
      message: `${fact.title} at ${fact.employer}: this resume says ${fact.start} – ${fact.end}, other variants say ${agreed.start} – ${agreed.end}`,
      hint: spec.hint,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// filenames
// ---------------------------------------------------------------------------

/** Tokens that mark a filename as naming a party rather than the candidate. */
const COMPANY_HINT = /_([A-Z][a-zA-Z0-9]+)/g;

export function lintFilenames(
  files: string[],
  {
    canonicalFilenames,
    targetCompany,
    knownCompanies = [],
  }: {
    /** The candidate's own upload filenames, from config. Empty disables the generic-name rule. */
    canonicalFilenames: string[];
    targetCompany: string;
    knownCompanies?: string[];
  },
): LintFinding[] {
  const findings: LintFinding[] = [];
  const generic = new Set(canonicalFilenames.filter(Boolean));
  const hasName = generic.size > 0;
  const target = normalizeCompany(targetCompany);
  const others = knownCompanies
    .map((c) => ({ raw: c, norm: normalizeCompany(c) }))
    .filter((c) => c.norm && c.norm !== target && c.norm.length >= 4);

  for (const file of files) {
    const name = basename(file);
    // Only files a portal would actually receive. `resume.html` / `resume-print.html`
    // are local review renders; flagging them would bury the real findings.
    if (!/\.(pdf|docx?)$/i.test(name)) continue;
    if (!/resume|cover/i.test(name)) continue;
    if (generic.has(name)) continue;

    if (hasName) {
      const spec = RULES["filename-not-generic"];
      findings.push({
        rule: "filename-not-generic",
        severity: spec.severity,
        message: `"${name}" is not the candidate's own filename (expected ${[...generic].join(" or ")})`,
        hint: spec.hint,
      });
    }

    const stem = normalizeCompany(name.replace(/\.[a-z0-9]+$/i, ""));
    const tokens = new Set<string>();
    for (const m of name.replace(/\.[a-z0-9]+$/i, "").matchAll(COMPANY_HINT)) {
      const token = m[1];
      if (token) tokens.add(normalizeCompany(token));
    }
    if (target && (stem.includes(target) || [...tokens].some((t) => t && target.includes(t)))) {
      const s = RULES["filename-names-company"];
      findings.push({
        rule: "filename-names-company",
        severity: s.severity,
        message: `"${name}" names the target company "${targetCompany}"`,
        hint: s.hint,
      });
      continue;
    }
    const other = others.find((c) => tokens.has(c.norm) || stem.includes(c.norm));
    if (other) {
      const s = RULES["filename-names-other-company"];
      findings.push({
        rule: "filename-names-other-company",
        severity: s.severity,
        message: `"${name}" names "${other.raw}", a different company than the one applied to`,
        hint: s.hint,
      });
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// service
// ---------------------------------------------------------------------------

export interface ResumeLintOptions {
  /** Skip cross-variant fact agreement (used when linting a brand-new variant). */
  skipFactCheck?: boolean;
}

/** Statuses that mean the resume has already gone out; the gate is too late there. */
const SENT_STATUSES = new Set(["submitted", "interviewing", "offer", "rejected"]);

export class ResumeLintService {
  readonly #applications: Collection<Application>;
  readonly #jobs: Collection<Job>;
  readonly #workspaceRoot: string;
  readonly #outreach: Pick<OutreachService, "list"> | null;
  /** The candidate's own upload filenames. Empty disables the generic-name rule. */
  readonly #canonicalFilenames: string[];

  constructor({
    applications,
    jobs,
    workspaceRoot,
    outreach = null,
    canonicalFilenames = [],
  }: {
    applications: Collection<Application>;
    jobs: Collection<Job>;
    workspaceRoot: string;
    /** Optional: enables the referral-collision rule. */
    outreach?: Pick<OutreachService, "list"> | null;
    canonicalFilenames?: string[];
  }) {
    this.#applications = applications;
    this.#jobs = jobs;
    this.#workspaceRoot = workspaceRoot;
    this.#outreach = outreach;
    this.#canonicalFilenames = canonicalFilenames;
  }

  async check(appId: string, opts: ResumeLintOptions = {}): Promise<LintReport> {
    const app = await this.#applications.get(appId).catch(() => {
      throw new Error(`no application with id ${appId}`);
    });
    const job = await this.#jobs.get(app.jobId).catch(() => null);
    const company = job?.company ?? "";

    const findings: LintFinding[] = [];

    // 1. the registered resume, if it is a markdown source we can read
    const resumeRef = app.artifacts?.resume ?? null;
    if (resumeRef && resumeRef.endsWith(".md")) {
      const md = await this.#readWorkspaceFile(resumeRef);
      if (md !== null) {
        findings.push(...lintResumeMarkdown(md, { targetCompany: company }));
        if (!opts.skipFactCheck) {
          const baseline = await this.#baseline();
          findings.push(...factDrift(extractEmploymentFacts(md), baseline));
        }
      }
    }

    // 2. the resume and cover-letter files that will actually be uploaded
    const files = await this.#listAppFiles(appId);
    findings.push(
      ...lintFilenames(files, {
        canonicalFilenames: this.#canonicalFilenames,
        targetCompany: company,
        knownCompanies: await this.#knownCompanies(),
      }),
    );

    // 3. bookkeeping that leaks one application's files into another's record
    const owner = ownerAppId(resumeRef);
    if (owner && owner !== appId) {
      const s = RULES["artifact-foreign-dir"];
      findings.push({
        rule: "artifact-foreign-dir",
        severity: s.severity,
        message: `resume artifact points at ${resumeRef}, which belongs to ${owner}`,
        hint: s.hint,
      });
    }

    // 4. company-level strategy
    if (company) {
      findings.push(...(await this.#companyFindings(app, company)));
    }

    return { appId, company, findings };
  }

  async checkAll(opts: ResumeLintOptions = {}): Promise<LintReport[]> {
    const apps = await this.#applications.list();
    const reports: LintReport[] = [];
    for (const app of apps) reports.push(await this.check(app.id, opts));
    return reports;
  }

  /** Every registered resume variant, so the baseline is the majority verdict. */
  async #baseline(): Promise<Map<string, EmploymentFact>> {
    const apps = await this.#applications.list();
    const seen = new Set<string>();
    const variants: EmploymentFact[][] = [];
    for (const app of apps) {
      const ref = app.artifacts?.resume;
      // Dedupe by path: two applications pointing at one file are one variant,
      // not two independent votes on the same dates.
      if (!ref || !ref.endsWith(".md") || seen.has(ref)) continue;
      seen.add(ref);
      const md = await this.#readWorkspaceFile(ref);
      if (md !== null) variants.push(extractEmploymentFacts(md));
    }
    return baselineFacts(variants);
  }

  async #companyFindings(app: Application, company: string): Promise<LintFinding[]> {
    const findings: LintFinding[] = [];
    const apps = await this.#applications.list();
    const siblings: { app: Application; job: Job | null }[] = [];
    for (const other of apps) {
      if (other.id === app.id) continue;
      const job = await this.#jobs.get(other.jobId).catch(() => null);
      if (job && normalizeCompany(job.company) === normalizeCompany(company)) siblings.push({ app: other, job });
    }
    if (!siblings.length) return findings;

    // Two different resume sources at one company on one day reads as several
    // unrelated stories from one person.
    const day = (a: Application) => (a.submittedAt ?? "").slice(0, 10);
    const mine = day(app);
    if (mine) {
      const sameDay = [app, ...siblings.filter((s) => day(s.app) === mine).map((s) => s.app)];
      const refs = new Set(
        sameDay
          .map((a) => a.artifacts?.resume ?? null)
          .filter((r): r is string => r !== null && r.endsWith(".md")),
      );
      if (refs.size > 1) {
        const s = RULES["company-multi-resume"];
        findings.push({
          rule: "company-multi-resume",
          severity: s.severity,
          message: `${refs.size} different resume sources went to ${company} on ${mine}`,
          hint: s.hint,
        });
      }
    }

    const live = [app, ...siblings.map((s) => s.app)].filter((a) => SENT_STATUSES.has(a.status));
    const referrals = await this.#referrals();
    const referred = live.filter((a) => (referrals.get(a.id) ?? 0) > 0);
    if (referred.length && live.length > 1) {
      const s = RULES["referral-collision"];
      findings.push({
        rule: "referral-collision",
        severity: s.severity,
        message: `${live.length} applications at ${company}, with a live referral on ${referred.length} of them`,
        hint: s.hint,
      });
    }
    return findings;
  }

  /** Referral sends per application, used by the collision rule. */
  async #referrals(): Promise<Map<string, number>> {
    if (!this.#outreach) return new Map();
    const messages = await this.#outreach.list({ all: true });
    return referralCounts(messages);
  }

  async #knownCompanies(): Promise<string[]> {
    const jobs = await this.#jobs.list();
    return [...new Set(jobs.map((j) => j.company).filter(Boolean))];
  }

  async #listAppFiles(appId: string): Promise<string[]> {
    try {
      return await readdir(join(this.#workspaceRoot, "applications", appId));
    } catch {
      return [];
    }
  }

  async #readWorkspaceFile(rel: string): Promise<string | null> {
    try {
      return await readFile(join(this.#workspaceRoot, rel), "utf8");
    } catch {
      return null;
    }
  }
}

/** `applications/app-1234/resume.md` -> `app-1234`; null when not app-scoped. */
export function ownerAppId(ref: string | null | undefined): string | null {
  const m = /applications\/(app-[a-z0-9]+)\//i.exec(ref ?? "");
  return m?.[1] ?? null;
}
