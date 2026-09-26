import { readFile, readdir, stat } from "node:fs/promises";
import { join, relative, sep } from "node:path";

import { termCounts, topTerms, extractTerms } from "./terms.js";
import { writeJsonAtomic } from "../fsutil.js";

const INDEX_VERSION = 1;
const TEXT_EXTENSIONS = /\.(md|markdown|txt)$/i;
const FILE_KEYWORD_LIMIT = 30;
const GLOBAL_KEYWORD_LIMIT = 200;

/**
 * Service: scans a resume dossier directory into a searchable profile index
 * (titles, sections, per-file keywords) and answers retrieval queries.
 */
export class DossierIndexer {
  constructor(dossierDir) {
    this.dossierDir = dossierDir;
  }

  /** Walk the dossier and build the profile index. */
  async index({ now = new Date().toISOString() } = {}) {
    const paths = await this.#walk(this.dossierDir);
    const files = [];
    const globalCounts = new Map();
    for (const abs of paths) {
      const rel = relative(this.dossierDir, abs).split(sep).join("/");
      const content = await readFile(abs, "utf8");
      const counts = termCounts(content);
      for (const [term, count] of counts) {
        globalCounts.set(term, (globalCounts.get(term) ?? 0) + count);
      }
      files.push({
        path: rel,
        kind: classify(rel),
        title: firstHeading(content) ?? rel.replace(/\.[^.]+$/, ""),
        sections: markdownHeadings(content),
        words: content.split(/\s+/).filter(Boolean).length,
        bytes: (await stat(abs)).size,
        keywords: topTerms(counts, { limit: FILE_KEYWORD_LIMIT }),
      });
    }
    const fileCountFor = (term) => files.filter((f) => f.keywords.some((k) => k.term === term)).length;
    const keywords = topTerms(globalCounts, { limit: GLOBAL_KEYWORD_LIMIT }).map((k) => ({
      ...k,
      files: fileCountFor(k.term),
    }));
    return {
      version: INDEX_VERSION,
      indexedAt: now,
      root: this.dossierDir,
      files,
      keywords,
      stats: {
        files: files.length,
        words: files.reduce((sum, f) => sum + f.words, 0),
      },
    };
  }

  /**
   * Rank dossier files against a free-text query (job description excerpt,
   * skill list, ...). Returns [{ path, kind, title, score, matched }].
   */
  search(index, query) {
    const terms = [...new Set(extractTerms(query))];
    const hits = [];
    for (const file of index.files ?? []) {
      const kw = new Map(file.keywords.map((k) => [k.term, k.count]));
      const titleLc = file.title.toLowerCase();
      const sectionsLc = file.sections.join(" \n ").toLowerCase();
      let score = 0;
      const matched = [];
      for (const term of terms) {
        let termScore = 0;
        if (kw.has(term)) termScore += 2 + 0.1 * Math.min(kw.get(term), 5);
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

  async save(index, filePath) {
    await writeJsonAtomic(filePath, index);
    return filePath;
  }

  async #walk(dir) {
    const out = [];
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (err) {
      throw new Error(`cannot read dossier directory ${dir}: ${err.message}`, { cause: err });
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

export async function loadDossierIndex(indexPath) {
  return JSON.parse(await readFile(indexPath, "utf8"));
}

/** Classify a dossier file by its path: what kind of document is it? */
export function classify(relPath) {
  const p = relPath.toLowerCase();
  if (/master/.test(p)) return "master-resume";
  if (/cover/.test(p)) return "cover-letter";
  if (/(skill|competenc)/.test(p)) return "skills";
  if (/(history|experience|education|achievement|accomplishment|fact)/.test(p) || /(^|\/)facts\//.test(p)) return "background";
  if (/(^|\/)(resumes?|cv)(\/|$)/.test(p) || /(resume|cv)[.-]/.test(p)) return "resume";
  return "other";
}

function firstHeading(content) {
  const m = content.match(/^#\s+(.+)$/m);
  return m ? m[1].trim() : null;
}

function markdownHeadings(content) {
  const out = [];
  for (const line of content.split(/\r?\n/)) {
    const m = line.match(/^(#{2,6})\s+(.+?)\s*#*\s*$/);
    if (m) out.push(m[2].trim());
  }
  return out;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}
