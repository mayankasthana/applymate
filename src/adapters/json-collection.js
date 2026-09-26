import { mkdir, readFile, readdir, unlink } from "node:fs/promises";
import { join } from "node:path";

import { writeJsonAtomic } from "../fsutil.js";

/**
 * Port: a durable collection of JSON records, one file per record.
 *
 * @typedef {Object} Collection
 * @property {(record: object) => Promise<object>} put
 * @property {(id: string) => Promise<object>} get
 * @property {() => Promise<object[]>} list
 * @property {(pred: (r: object) => boolean) => Promise<object|null>} find
 * @property {(id: string) => Promise<void>} delete
 */

export class StoreError extends Error {
  constructor(message, { code = "STORE", cause = undefined } = {}) {
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
export class JsonCollection {
  /**
   * @param {object} opts
   * @param {string} opts.dir directory holding one `<id>.json` per record
   * @param {string} opts.entityName used in error messages ("job", "application", ...)
   * @param {(record: object) => object} [opts.validate] required; throws to reject a record
   */
  constructor({ dir, entityName, validate }) {
    if (typeof validate !== "function") {
      throw new StoreError(`JsonCollection(${entityName}) requires a validate hook`);
    }
    this.dir = dir;
    this.entityName = entityName;
    this.validate = validate;
  }

  pathFor(id) {
    return join(this.dir, `${id}.json`);
  }

  async put(record) {
    if (!record || typeof record.id !== "string" || !/^[a-z0-9][a-z0-9._-]*$/i.test(record.id)) {
      throw new StoreError(`${this.entityName} record needs a safe non-empty id`);
    }
    let checked;
    try {
      checked = this.validate(record);
    } catch (err) {
      throw new StoreError(`invalid ${this.entityName} record ${record.id}: ${err.message}`, { code: "INVALID", cause: err });
    }
    await writeJsonAtomic(this.pathFor(record.id), checked);
    return checked;
  }

  async get(id) {
    let raw;
    try {
      raw = await readFile(this.pathFor(id), "utf8");
    } catch (err) {
      if (err.code === "ENOENT") {
        throw new StoreError(`no ${this.entityName} with id ${id}`, { code: "NOT_FOUND" });
      }
      throw new StoreError(`cannot read ${this.entityName} ${id}: ${err.message}`, { cause: err });
    }
    return this.#parse(raw, id);
  }

  async list() {
    let names;
    try {
      names = await readdir(this.dir);
    } catch (err) {
      if (err.code === "ENOENT") return [];
      throw new StoreError(`cannot list ${this.entityName} directory: ${err.message}`, { cause: err });
    }
    const records = [];
    for (const name of names.filter((n) => n.endsWith(".json")).sort()) {
      const raw = await readFile(join(this.dir, name), "utf8");
      records.push(this.#parse(raw, name.replace(/\.json$/, "")));
    }
    return records.sort(
      (a, b) => String(a.createdAt ?? "").localeCompare(String(b.createdAt ?? "")) || String(a.id).localeCompare(String(b.id))
    );
  }

  async find(pred) {
    for (const record of await this.list()) {
      if (pred(record)) return record;
    }
    return null;
  }

  async delete(id) {
    try {
      await unlink(this.pathFor(id));
    } catch (err) {
      if (err.code === "ENOENT") {
        throw new StoreError(`no ${this.entityName} with id ${id}`, { code: "NOT_FOUND" });
      }
      throw new StoreError(`cannot delete ${this.entityName} ${id}: ${err.message}`, { cause: err });
    }
  }

  /** Ensure the backing directory exists (idempotent). */
  async ensureDir() {
    await mkdir(this.dir, { recursive: true });
  }

  #parse(raw, id) {
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      throw new StoreError(`invalid ${this.entityName} record ${id}: not valid JSON`, { code: "INVALID", cause: err });
    }
    try {
      return this.validate(parsed);
    } catch (err) {
      throw new StoreError(`invalid ${this.entityName} record ${id}: ${err.message}`, { code: "INVALID", cause: err });
    }
  }
}
