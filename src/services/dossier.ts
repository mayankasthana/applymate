import { readFile, readdir, stat } from "node:fs/promises";
import { join, relative, sep } from "node:path";

import { termCounts, topTerms, extractTerms } from "./terms.ts";
import { writeJsonAtomic } from "../fsutil.ts";

const INDEX_VERSION = 2;
const TEXT_EXTENSIONS = /\.(md|markdown|txt)$/i;
const FILE_KEYWORD_LIMIT = 30;
const GLOBAL_KEYWORD_LIMIT = 200;
// Effectively uncapped: the match vocabulary must not drop real experience
// terms just because the corpus is large (a 200-term cap is what made scores
// collapse to single digits on real dossiers). The bound only keeps the
// index JSON sane for pathological inputs.
const PROFILE_KEYWORD_LIMIT = 50_000;

export type DossierKind = "master-resume" | "cover-letter" | "skills" | "background" | "resume" | "other";
export type DossierRole = "profile" | "reference";

export interface DossierFile {
  path: string;
  kind: DossierKind;
  role: DossierRole;
  title: string;
  sections: string[];
  words: number;
  bytes: number;
  keywords: { term: string; count: number }[];
}

export interface DossierIndex {
  version: number;
  indexedAt: string;
  root: string;
  files: DossierFile[];
  /** Legacy global top-term list (all files). Kept for display/back-compat. */
  keywords: { term: string; count: number; files: number }[];
  /** Match vocabulary: terms from profile files only, effectively uncapped. */
  profileKeywords: { term: string; count: number }[];
  stats: { files: number; words: number; profileFiles: number; referenceFiles: number };
}

export interface DossierHit {
  path: string;
  kind: DossierKind;
  title: string;
  score: number;
  matched: string[];
}

export interface DossierIndexerOptions {
  /** Glob patterns (matched against the dossier-relative path, `*` = any run of characters) that force files into the profile match vocabulary. */
  profileGlobs?: string[];
  /** Glob patterns that force files out of it; wins over profileGlobs. */
  referenceGlobs?: string[];
}

/** Classify a dossier file by its path: what kind of document is it? */
export function classify(relPath: string): DossierKind {
  const p = relPath.toLowerCase();
  if (/master/.test(p)) return "master-resume";
  if (/cover/.test(p)) return "cover-letter";
  if (/(skill|competenc)/.test(p)) return "skills";
  if (/(history|experience|education|achievement|accomplishment|fact)/.test(p) || /(^|\/)facts\//.test(p)) return "background";
  if (/(^|\/)(resumes?|cv)(\/|$)/.test(p) || /(resume|cv)[.-]/.test(p)) return "resume";
  return "other";
}

const REFERENCE_PATH_RE =
  /(interview|prep\b|call[-_ ]?pre|chat|email|e-?mail|archive|notes|findings|cover|readme|reply|recruit|job[-_ ]?descript|\bjd[-_. ]|offer)/;

/**
 * Decide whether a file feeds the match vocabulary.
 * "profile" = evidence of the candidate's real experience (resumes, work
 * history, project docs). "reference" = context worth searching but not
 * evidence (interview prep, chat/email archives, raw notes, cover letters
 * written for other companies). Explicit profile globs win (whitelist mode:
 * force everything out with `referenceGlobs: ["*"]`, then re-include core
 * docs), then reference globs, then the heuristic — which defaults to profile
 * so real experience docs are never dropped.
 */
export function classifyRole(
  relPath: string,
  profileGlobs: string[] = [],
  referenceGlobs: string[] = []
): DossierRole {
  if (profileGlobs.some((g) => globToRegExp(g).test(relPath))) return "profile";
  if (referenceGlobs.some((g) => globToRegExp(g).test(relPath))) return "reference";
  if (classify(relPath) === "cover-letter") return "reference";
  if (REFERENCE_PATH_RE.test(relPath.toLowerCase())) return "reference";
  return "profile";
}

function globToRegExp(glob: string): RegExp {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`, "i");
}

/**
 * Service: scans a resume dossier directory into a searchable profile index
 * (titles, sections, per-file keywords) and answers retrieval queries.
 */
export class DossierIndexer {
  readonly dossierDir: string;
  readonly #profileGlobs: string[];
  readonly #referenceGlobs: string[];

  constructor(dossierDir: string, { profileGlobs = [], referenceGlobs = [] }: DossierIndexerOptions = {}) {
    this.dossierDir = dossierDir;
    this.#profileGlobs = profileGlobs;
    this.#referenceGlobs = referenceGlobs;
  }

  /** Walk the dossier and build the profile index. */
  async index({ now = new Date().toISOString() }: { now?: string } = {}): Promise<DossierIndex> {
    const paths = await this.#walk(this.dossierDir);
    const files: DossierFile[] = [];
    const globalCounts = new Map<string, number>();
    const profileCounts = new Map<string, number>();
    for (const abs of paths) {
      const rel = relative(this.dossierDir, abs).split(sep).join("/");
      const content = await readFile(abs, "utf8");
      const counts = termCounts(content);
      for (const [term, count] of counts) {
        globalCounts.set(term, (globalCounts.get(term) ?? 0) + count);
      }
      const role = classifyRole(rel, this.#profileGlobs, this.#referenceGlobs);
      if (role === "profile") {
        for (const [term, count] of counts) {
          profileCounts.set(term, (profileCounts.get(term) ?? 0) + count);
        }
      }
      files.push({
        path: rel,
        kind: classify(rel),
        role,
        title: firstHeading(content) ?? rel.replace(/\.[^.]+$/, ""),
        sections: markdownHeadings(content),
        words: content.split(/\s+/).filter(Boolean).length,
        bytes: (await stat(abs)).size,
        keywords: topTerms(counts, { limit: FILE_KEYWORD_LIMIT }),
      });
    }
    const fileCountFor = (term: string) => files.filter((f) => f.keywords.some((k) => k.term === term)).length;
    const keywords = topTerms(globalCounts, { limit: GLOBAL_KEYWORD_LIMIT }).map((k) => ({
      ...k,
      files: fileCountFor(k.term),
    }));
    const profileFiles = files.filter((f) => f.role === "profile").length;
    return {
      version: INDEX_VERSION,
      indexedAt: now,
      root: this.dossierDir,
      files,
      keywords,
      profileKeywords: topTerms(profileCounts, { limit: PROFILE_KEYWORD_LIMIT }),
      stats: {
        files: files.length,
        words: files.reduce((sum, f) => sum + f.words, 0),
        profileFiles,
        referenceFiles: files.length - profileFiles,
      },
    };
  }

  /** Rank dossier files against a free-text query (JD excerpt, skills, ...). */
  search(index: DossierIndex, query: string): DossierHit[] {
    const terms = [...new Set(extractTerms(query))];
    const hits: DossierHit[] = [];
    for (const file of index.files ?? []) {
      const kw = new Map(file.keywords.map((k) => [k.term, k.count]));
      const titleLc = file.title.toLowerCase();
      const sectionsLc = file.sections.join(" \n ").toLowerCase();
      let score = 0;
      const matched: string[] = [];
      for (const term of terms) {
        let termScore = 0;
        if (kw.has(term)) termScore += 2 + 0.1 * Math.min(kw.get(term) ?? 0, 5);
        if (titleLc.includes(term)) termScore += 3;
        if (sectionsLc.includes(term)) termScore += 1;
        if (termScore > 0) {
          score += termScore;
          matched.push(term);
        }
      }
      if (score > 0) hits.push({ path: file.path, kind: file.kind, title: file.title, score: round2(score), matched });
    }
    return hits.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
  }

  async save(index: DossierIndex, filePath: string): Promise<string> {
    await writeJsonAtomic(filePath, index);
    return filePath;
  }

  async #walk(dir: string): Promise<string[]> {
    const out: string[] = [];
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (err) {
      throw new Error(`cannot read dossier directory ${dir}: ${(err as Error).message}`, { cause: err });
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) {
        out.push(...(await this.#walk(abs)));
      } else if (entry.isFile() && TEXT_EXTENSIONS.test(entry.name)) {
        out.push(abs);
      }
    }
    return out;
  }
}

export async function loadDossierIndex(indexPath: string): Promise<DossierIndex> {
  return JSON.parse(await readFile(indexPath, "utf8")) as DossierIndex;
}

/** Search an index without needing an indexer instance. */
export function searchDossier(index: DossierIndex, query: string): DossierHit[] {
  return new DossierIndexer(".").search(index, query);
}

function firstHeading(content: string): string | null {
  const m = content.match(/^#\s+(.+)$/m);
  return m ? m[1]!.trim() : null;
}

function markdownHeadings(content: string): string[] {
  const out: string[] = [];
  for (const line of content.split(/\r?\n/)) {
    const m = line.match(/^(#{2,6})\s+(.+?)\s*#*\s*$/);
    if (m) out.push(m[2]!.trim());
  }
  return out;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
