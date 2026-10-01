import { isReminderDue, Reminder, type Reminder as ReminderRecord, type ReminderInput } from "../domain.ts";
import type { Collection } from "../adapters/json-collection.ts";

export type ReminderState = "due" | "upcoming" | "done";

/**
 * Service: dated decisions that must resurface. The failure this exists for:
 * a fallback rule written into notes is a deadline nobody sees. Reminders are
 * read by the boot sequence (`reminders list --due`) so any harness, in any
 * session, trips over what's due instead of relying on memory or luck.
 */
export class ReminderService {
  readonly #reminders: Collection<ReminderRecord>;

  constructor({ reminders }: { reminders: Collection<ReminderRecord> }) {
    this.#reminders = reminders;
  }

  async add(input: ReminderInput, { now = new Date().toISOString() } = {}): Promise<ReminderRecord> {
    return this.#reminders.put(Reminder.create(input, { now }));
  }

  get(id: string): Promise<ReminderRecord> {
    return this.#reminders.get(id);
  }

  /**
   * List reminders, soonest due first. Default: open (not done). `due`
   * narrows to what's due right now; `all` includes done history.
   */
  async list({ appId, due = false, all = false, now = Date.now() }: { appId?: string; due?: boolean; all?: boolean; now?: number } = {}): Promise<ReminderRecord[]> {
    let records = await this.#reminders.list();
    if (appId) records = records.filter((r) => r.appId === appId);
    if (!all) records = records.filter((r) => !r.doneAt);
    if (due) return records.filter((r) => isReminderDue(r, now)).sort(byDueAtAsc);
    return records.sort(byDueAtAsc);
  }

  /** Record the decision being acted on. Idempotent: keeps the first time. */
  async markDone(id: string, { at = new Date().toISOString() } = {}): Promise<ReminderRecord> {
    const rem = await this.#reminders.get(id);
    if (rem.doneAt) return rem;
    return this.#reminders.put({ ...rem, doneAt: at });
  }
}

/** Derive the display state for a reminder. */
export function reminderState(rem: ReminderRecord, now = Date.now()): ReminderState {
  if (rem.doneAt) return "done";
  return isReminderDue(rem, now) ? "due" : "upcoming";
}

const byDueAtAsc = (a: ReminderRecord, b: ReminderRecord): number =>
  Date.parse(a.dueAt) - Date.parse(b.dueAt) || String(a.id).localeCompare(String(b.id));
