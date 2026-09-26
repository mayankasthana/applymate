import { randomInt } from "node:crypto";

const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
const CODE_LENGTH = 4;
const MAX_SLUG_LENGTH = 48;

/** "Senior Backend Engineer" -> "senior-backend-engineer" */
export function slugify(text) {
  const slug = String(text ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/g, "");
  return slug;
}

/** Short random suffix, e.g. "k3f9". */
export function shortCode() {
  let out = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    out += ALPHABET[randomInt(ALPHABET.length)];
  }
  return out;
}

/** "job-acme-corp-xxxx" — collision-resistant, human-readable ids. */
export function makeId(prefix, text = "") {
  const slug = slugify(text);
  return slug ? `${prefix}-${slug}-${shortCode()}` : `${prefix}-${shortCode()}`;
}
