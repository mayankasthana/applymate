import { mkdir, readFile, readdir, unlink } from "node:fs/promises";
import { join } from "node:path";

import { writeJsonAtomic } from "../fsutil.ts";

/** Port: a durable collection of JSON records, one file per record. */
export interface Collection<T extends { id: string }> {
  put(record: T): Promise<T>;
  get(id: string): Promise<T>;
  list(): Promise<T[]>;
  find(pred: (record: T) => boolean): Promise<T | null>;
  delete(id: string): Promise<void>;
}

export class StoreError extends Error {
  code: string;
  constructor(message: string, { code = "STORE", cause = undefined }: { code?: string; cause?: unknown } = {}) {
    super(message, cause !== undefined ? { cause } : undefined);
    this.name = "StoreError";
    this.code = code;
  }
}

/**
 * Adapter: implements the Collection port over a directory of
 * `<id>.json` files with atomic writes. Validation strategy is injected,
 * so the adapter knows nothing about domain entities (DIP).
 */
export class JsonCollection<T extends { id: string }> implements Collection<T> {
  readonly dir: string;
  readonly entityName: string;
  readonly #validate: (record: T) => T;

  constructor({ dir, entityName, validate }: { dir: string; entityName: string; validate: (record: T) => T }) {
    if (typeof validate !== "function") {
      throw new StoreError(`JsonCollection(${entityName}) requires a validate hook`);
    }
    this.dir = dir;
    this.entityName = entityName;
    this.#validate = validate;
  }

  pathFor(id: string): string {
    return join(this.dir, `${id}.json`);
  }

  async put(record: T): Promise<T> {
    if (!record || typeof record.id !== "string" || !/^[a-z0-9][a-z0-9._-]*$/i.test(record.id)) {
      throw new StoreError(`${this.entityName} record needs a safe non-empty id`);
    }
    let checked: T;
    try {
      checked = this.#validate(record);
    } catch (err) {
      throw new StoreError(`invalid ${this.entityName} record ${record.id}: ${(err as Error).message}`, {
        code: "INVALID",
        cause: err,
      });
    }
    await writeJsonAtomic(this.pathFor(record.id), checked);
    return checked;
  }

  async get(id: string): Promise<T> {
    let raw: string;
    try {
      raw = await readFile(this.pathFor(id), "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        throw new StoreError(`no ${this.entityName} with id ${id}`, { code: "NOT_FOUND" });
      }
      throw new StoreError(`cannot read ${this.entityName} ${id}: ${(err as Error).message}`, { cause: err });
    }
    return this.#parse(raw, id);
  }

  async list(): Promise<T[]> {
    let names: string[];
    try {
      names = await readdir(this.dir);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw new StoreError(`cannot list ${this.entityName} directory: ${(err as Error).message}`, { cause: err });
    }
    const records: T[] = [];
    for (const name of names.filter((n) => n.endsWith(".json")).sort()) {
      const raw = await readFile(join(this.dir, name!), "utf8");
      records.push(this.#parse(raw, name!.replace(/\.json$/, "")));
    }
    return records.sort(
      (a, b) =>
        String((a as { createdAt?: string }).createdAt ?? "").localeCompare(
          String((b as { createdAt?: string }).createdAt ?? "")
        ) || String(a.id).localeCompare(String(b.id))
    );
  }

  async find(pred: (record: T) => boolean): Promise<T | null> {
    for (const record of await this.list()) {
      if (pred(record)) return record;
    }
    return null;
  }

  async delete(id: string): Promise<void> {
    try {
      await unlink(this.pathFor(id));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        throw new StoreError(`no ${this.entityName} with id ${id}`, { code: "NOT_FOUND" });
      }
      throw new StoreError(`cannot delete ${this.entityName} ${id}: ${(err as Error).message}`, { cause: err });
    }
  }

  /** Ensure the backing directory exists (idempotent). */
  async ensureDir(): Promise<void> {
    await mkdir(this.dir, { recursive: true });
  }

  #parse(raw: string, id: string): T {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      throw new StoreError(`invalid ${this.entityName} record ${id}: not valid JSON`, { code: "INVALID", cause: err });
    }
    try {
      return this.#validate(parsed as T);
    } catch (err) {
      throw new StoreError(`invalid ${this.entityName} record ${id}: ${(err as Error).message}`, {
        code: "INVALID",
        cause: err,
      });
    }
  }
}
