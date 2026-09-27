/**
 * Build a browser-rig task spec from the candidate's stored answers
 * (`workspace/profile/answers.json`) — the input contract for `browser-rig/spec_server.py`
 * and `browser-rig/guard.py`.
 *
 * Only fields with a stored answer are mapped: a spec never invents a value. Unknown form
 * fields stay available to the decision model live (it can click/select them), but the
 * guard will not type text it has no source for.
 *
 * Two end states mirror the application pipeline:
 *  - mode "stage": DONE unlocks once every mapped field visibly holds its value — the
 *    candidate reviews and submits (the `ready` state; never auto-submits).
 *  - mode "submit": DONE unlocks only when `successText` appears on the page — used for
 *    sandbox/benchmark forms where the candidate has already approved submission.
 */

/** A known form field: how to recognize the stored question and the page field label. */
export interface FormFieldCategory {
  category: string;
  /** Matches the stored answer's question text (answers are free-form questions). */
  question: RegExp;
  /** Matches the form field label on the page (Python re syntax — the rig runs Python). */
  field: string;
}

export const FORM_FIELD_CATEGORIES: readonly FormFieldCategory[] = [
  { category: "firstName", question: /\b(first|given)\s+name\b/i, field: "first name" },
  { category: "lastName", question: /\b(last|family)\s+name|surname\b/i, field: "last name" },
  { category: "email", question: /\be-?mail\b/i, field: "user email|example\\.com|e-?mail" },
  { category: "phone", question: /\b(phone|mobile|cell)\b/i, field: "mobile|phone" },
  { category: "address", question: /\baddress\b/i, field: "current address|address" },
  { category: "linkedin", question: /\blinkedin\b/i, field: "linkedin" },
  { category: "website", question: /\b(website|portfolio|github)\b/i, field: "website|portfolio|github" },
];

/** The rig spec shape consumed by browser-rig/spec_server.py and guard.py. */
export interface RigSpec {
  name: string;
  /** [pageFieldLabelRegex, valueToType] — in priority order. */
  field_map: [string, string][];
  /** Visible conditions that gate DONE in "stage" mode. */
  required: { field: string; equals: string }[];
  suppress_enter?: boolean;
  suppress_click?: string[];
  suppress_type?: string[];
  done_when_text?: string;
}

/** Minimal shape of a stored answer (structural — avoids importing the store). */
export interface AnswerLike {
  question: string;
  answer: string;
}

export interface BuildFormSpecOptions {
  name: string;
  answers: readonly AnswerLike[];
  /** Fallback for the first-name field when no stored answer matches (prefs candidateName). */
  candidateName?: string;
  /** "stage" (default) gates DONE on filled fields; "submit" gates on the success text. */
  mode?: "stage" | "submit";
  /** Required with mode "submit": page text that proves the form was accepted. */
  successText?: string;
  /** Extra click-target label blacklists (site nav, ads) — merged after the defaults. */
  suppressClick?: string[];
}

export const DEFAULT_SUPPRESS_CLICK: readonly string[] = ["^Ad ", "^Close$", "^Open "];

export function buildFormSpec(opts: BuildFormSpecOptions): RigSpec {
  const mode = opts.mode ?? "stage";
  if (mode === "submit" && !opts.successText?.trim()) {
    throw new Error(`mode "submit" requires successText (the page text that proves submission)`);
  }

  const fieldMap: [string, string][] = [];
  const required: { field: string; equals: string }[] = [];
  for (const category of FORM_FIELD_CATEGORIES) {
    const answer = opts.answers.find((a) => category.question.test(a.question))?.answer?.trim();
    const value = answer || (category.category === "firstName" ? opts.candidateName?.trim() : undefined);
    if (!value) continue; // no source for this field — never invent one
    fieldMap.push([category.field, value]);
    required.push({ field: category.field, equals: value });
  }

  const spec: RigSpec = {
    name: opts.name,
    field_map: fieldMap,
    required,
    suppress_enter: true,
    suppress_click: [...DEFAULT_SUPPRESS_CLICK, ...(opts.suppressClick ?? [])],
  };
  if (mode === "submit") spec.done_when_text = opts.successText!.trim();
  return spec;
}
