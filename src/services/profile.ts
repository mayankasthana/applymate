import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { writeJsonAtomic } from "../fsutil.ts";
import { extractTerms } from "./terms.ts";

/**
 * Service: the per-user personalization stores. Everything here lives under
 * `workspace/profile/` (gitignored) — the repo never hardcodes the user's
 * decisions; the agent reads and writes these files through the CLI.
 *
 *  - preferences: durable decisions ("product-based companies", salary floor,
 *    locations, ...). The agent asks about missing ones at session start and
 *    persists the answers.
 *  - answers: application-form question/answer pairs ("Have you used X?",
 *    "Are you authorized to work in...?"). The browser-apply protocol reads
 *    them to fill forms and records every new answer for next time.
 */

export type PrefValue = string | number | boolean | string[];

export interface PreferenceRecord {
  key: string;
  value: PrefValue;
  updatedAt: string;
  /** Where this came from: asked-in-chat, user-set, inferred (marked so). */
  source: "chat" | "user" | "inferred";
  note?: string;
}

export interface PreferenceFile {
  version: 1;
  preferences: Record<string, PreferenceRecord>;
}

export interface AnswerRecord {
  /** Normalized question used as the lookup key. */
  key: string;
  /** The question as originally asked. */
  question: string;
  answer: string;
  updatedAt: string;
}

export interface AnswerFile {
  version: 1;
  answers: Record<string, AnswerRecord>;
}

/** Keys the agent should ask about when unset — suggested, never assumed. */
export const RECOMMENDED_PREFERENCE_KEYS: readonly string[] = [
  "companyType", // e.g. "product-based" | "service-based" | "either"
  "salaryFloor", // number, in the user's currency
  "workMode", // e.g. "remote" | "hybrid" | "onsite" | "any"
  "locations", // acceptable locations
  "seniority", // target level
];

export class ProfileStore {
  readonly #dir: string;
  readonly #prefsPath: string;
  readonly #answersPath: string;
  readonly #now: () => string;

  constructor({ dir, now = () => new Date().toISOString() }: { dir: string; now?: () => string }) {
    this.#dir = dir;
    this.#prefsPath = join(dir, "preferences.json");
    this.#answersPath = join(dir, "answers.json");
    this.#now = now;
  }

  get paths(): { preferences: string; answers: string } {
    return { preferences: this.#prefsPath, answers: this.#answersPath };
  }

  // -- preferences ------------------------------------------------------------

  async setPreference(key: string, value: PrefValue, { source = "user", note }: { source?: PreferenceRecord["source"]; note?: string } = {}): Promise<PreferenceRecord> {
    const normalized = normalizeKey(key);
    if (!normalized) throw new Error(`preference key must be a non-empty string`);
    const file = await this.#loadPrefs();
    const record: PreferenceRecord = { key: normalized, value, updatedAt: this.#now(), source, ...(note ? { note } : {}) };
    file.preferences[normalized] = record;
    await writeJsonAtomic(this.#prefsPath, file);
    return record;
  }

  async getPreference(key: string): Promise<PreferenceRecord | null> {
    const file = await this.#loadPrefs();
    return file.preferences[normalizeKey(key)] ?? null;
  }

  async preferences(): Promise<PreferenceRecord[]> {
    const file = await this.#loadPrefs();
    return Object.values(file.preferences).sort((a, b) => a.key.localeCompare(b.key));
  }

  /** Recommended keys with no value yet — what the agent should ask about. */
  async missingPreferences(): Promise<string[]> {
    const file = await this.#loadPrefs();
    return RECOMMENDED_PREFERENCE_KEYS.filter((k) => !file.preferences[normalizeKey(k)]);
  }

  // -- answers (application form memory) ---------------------------------------

  async recordAnswer(question: string, answer: string, { source = "user" }: { source?: PreferenceRecord["source"] } = {}): Promise<AnswerRecord> {
    void source;
    if (typeof question !== "string" || !question.trim()) throw new Error(`question must be a non-empty string`);
    if (typeof answer !== "string" || !answer.trim()) throw new Error(`answer must be a non-empty string`);
    const file = await this.#loadAnswers();
    const key = answerKey(question);
    const record: AnswerRecord = { key, question: question.trim(), answer: answer.trim(), updatedAt: this.#now() };
    file.answers[key] = record;
    await writeJsonAtomic(this.#answersPath, file);
    return record;
  }

  /**
   * Look up a stored answer for a question. Exact normalized-key match wins;
   * otherwise the best term-overlap match above a small threshold.
   */
  async findAnswer(question: string): Promise<AnswerRecord | null> {
    if (!question?.trim()) return null;
    const file = await this.#loadAnswers();
    const records = Object.values(file.answers);
    if (!records.length) return null;

    const key = answerKey(question);
    const exact = records.find((r) => r.key === key);
    if (exact) return exact;

    const queryTerms = new Set(extractTerms(question));
    if (!queryTerms.size) return null;
    let best: { record: AnswerRecord; score: number } | null = null;
    for (const record of records) {
      const recordTerms = new Set(extractTerms(record.question));
      let overlap = 0;
      for (const t of queryTerms) if (recordTerms.has(t)) overlap++;
      const score = overlap / Math.min(queryTerms.size, recordTerms.size || 1);
      if (score >= 0.6 && (!best || score > best.score)) best = { record, score };
    }
    return best?.record ?? null;
  }

  async answers(): Promise<AnswerRecord[]> {
    const file = await this.#loadAnswers();
    return Object.values(file.answers).sort((a, b) => a.key.localeCompare(b.key));
  }

  // -- storage ------------------------------------------------------------------

  async #loadPrefs(): Promise<PreferenceFile> {
    return this.#loadJson(this.#prefsPath, { version: 1, preferences: {} });
  }

  async #loadAnswers(): Promise<AnswerFile> {
    return this.#loadJson(this.#answersPath, { version: 1, answers: {} });
  }

  async #loadJson<T>(path: string, fallback: T): Promise<T> {
    try {
      return JSON.parse(await readFile(path, "utf8")) as T;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return fallback;
      throw err;
    }
  }
}

/** Lowercase, strip punctuation, collapse spaces — "Years of Experience?" and
 *  "years of experience" land on the same key. */
export function answerKey(question: string): string {
  return question
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .slice(0, 120);
}

function normalizeKey(key: string): string {
  return typeof key === "string" ? key.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 60) : "";
}
