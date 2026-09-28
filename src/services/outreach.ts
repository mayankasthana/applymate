import {
  OutreachMessage,
  isFollowUpDue,
  type OutreachInput,
  type OutreachMessage as OutreachRecord,
} from "../domain.ts";
import type { Collection } from "../adapters/json-collection.ts";

export type OutreachState = "awaiting-reply" | "follow-up-due" | "followed-up" | "replied";

/**
 * Service: outreach bookkeeping for the message playbook. Prose and judgment
 * live with the agent; this store tracks the deterministic part the playbook
 * demands: every send, the single allowed follow-up (4–5 days later), and
 * replies (which retire the follow-up).
 */
export class OutreachService {
  readonly #messages: Collection<OutreachRecord>;

  constructor({ messages }: { messages: Collection<OutreachRecord> }) {
    this.#messages = messages;
  }

  async log(input: OutreachInput, { now = new Date().toISOString() } = {}): Promise<OutreachRecord> {
    return this.#messages.put(OutreachMessage.create(input, { now }));
  }

  get(id: string): Promise<OutreachRecord> {
    return this.#messages.get(id);
  }

  /**
   * List messages, newest first. Default: still-open threads (awaiting reply
   * or follow-up). `due` narrows to follow-ups due right now; `all` includes
   * replied/followed-up history.
   */
  async list({ appId, due = false, all = false, now = Date.now() }: { appId?: string; due?: boolean; all?: boolean; now?: number } = {}): Promise<OutreachRecord[]> {
    let records = await this.#messages.list();
    if (appId) records = records.filter((m) => m.appId === appId);
    if (due) return records.filter((m) => isFollowUpDue(m, now)).sort(bySentAtDesc);
    if (!all) records = records.filter((m) => !m.repliedAt);
    return records.sort(bySentAtDesc);
  }

  /** Record the reply that retires the follow-up. */
  async markReplied(id: string, { at = new Date().toISOString() } = {}): Promise<OutreachRecord> {
    const msg = await this.#messages.get(id);
    if (msg.repliedAt) return msg;
    return this.#messages.put({ ...msg, repliedAt: at });
  }

  /**
   * Record the single follow-up. Refuses a second one (playbook: send once)
   * and refuses after a reply (nothing to chase).
   */
  async markFollowedUp(id: string, { at = new Date().toISOString() } = {}): Promise<OutreachRecord> {
    const msg = await this.#messages.get(id);
    if (msg.repliedAt) throw new Error(`outreach ${id} was already replied to — no follow-up needed`);
    if (msg.followUpSentAt) throw new Error(`outreach ${id} already had its one follow-up (playbook rule: follow up once)`);
    return this.#messages.put({ ...msg, followUpSentAt: at });
  }
}

/** Derive the display state for a message. */
export function outreachState(msg: OutreachRecord, now = Date.now()): OutreachState {
  if (msg.repliedAt) return "replied";
  if (msg.followUpSentAt) return "followed-up";
  return isFollowUpDue(msg, now) ? "follow-up-due" : "awaiting-reply";
}

/** An outreach record joined with its derived display state (for UI/CLI views). */
export interface OutreachView extends OutreachRecord {
  state: OutreachState;
}

export function withState(msg: OutreachRecord, now = Date.now()): OutreachView {
  return { ...msg, state: outreachState(msg, now) };
}

/** Referral sends per linked application: appId → count of referrer messages. */
export function referralCounts(msgs: OutreachRecord[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const m of msgs) {
    if (m.appId && m.targetRole === "referrer") counts.set(m.appId, (counts.get(m.appId) ?? 0) + 1);
  }
  return counts;
}

const bySentAtDesc = (a: OutreachRecord, b: OutreachRecord): number => String(b.sentAt).localeCompare(String(a.sentAt));
