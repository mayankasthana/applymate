import { appendFile, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { mkdir } from "node:fs/promises";

const SENDERS = new Set(["user", "agent"]);
const POLL_INTERVAL_MS = 200;

/**
 * Service: the chat queue between the human (web UI) and the agent (CLI).
 *
 * One JSONL file, one message per line, ids are 1-based line numbers.
 * The UI appends user messages; the agent long-polls for them and appends
 * replies. No daemon state: every consumer tracks its own `since` cursor,
 * which makes the whole thing restart-proof.
 */
export class ChatLog {
  constructor({ filePath, now = () => new Date().toISOString() }) {
    this.filePath = filePath;
    this.now = now;
  }

  /** Append a message; returns the stored record with id/at filled in. */
  async append({ from, text, meta = null }) {
    if (!SENDERS.has(from)) {
      throw new Error(`message "from" must be one of ${[...SENDERS].join(", ")}, got: ${from}`);
    }
    if (typeof text !== "string" || text.trim().length === 0) {
      throw new Error(`message "text" must be a non-empty string`);
    }
    const lastId = await this.latestId();
    const record = { id: lastId + 1, at: this.now(), from, text, ...(meta ? { meta } : {}) };
    await mkdir(dirname(this.filePath), { recursive: true });
    await appendFile(this.filePath, `${JSON.stringify(record)}\n`, "utf8");
    return record;
  }

  /** Messages with id > since, oldest first. */
  async list({ since = 0 } = {}) {
    return (await this.#load()).filter((m) => m.id > since);
  }

  /**
   * Return user messages newer than `since`; if none, wait up to waitMs
   * polling the file (long-poll). Agent messages never satisfy a poll.
   */
  async poll({ since = 0, waitMs = 0 } = {}) {
    const deadline = Date.now() + waitMs;
    for (;;) {
      const fresh = (await this.list({ since })).filter((m) => m.from === "user");
      if (fresh.length > 0) return fresh;
      if (Date.now() >= deadline) return [];
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
  }

  /** Highest message id currently on disk (0 when empty). */
  async latestId() {
    const all = await this.#load();
    return all.length ? all[all.length - 1].id : 0;
  }

  /**
   * Parse the log, tolerating a torn trailing line (a write interrupted
   * mid-line). New appends continue from the last good id.
   */
  async #load() {
    let raw;
    try {
      raw = await readFile(this.filePath, "utf8");
    } catch (err) {
      if (err.code === "ENOENT") return [];
      throw err;
    }
    const messages = [];
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      try {
        const record = JSON.parse(line);
        if (SENDERS.has(record.from) && typeof record.text === "string" && Number.isInteger(record.id)) {
          messages.push(record);
        }
      } catch {
        // torn or corrupt line: ignore it
      }
    }
    return messages.sort((a, b) => a.id - b.id);
  }
}
