import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import type { Config } from "./config.ts";
import { JsonCollection } from "./adapters/json-collection.ts";
import { PipelineService } from "./services/pipeline.ts";
import { ChatLog } from "./services/inbox.ts";
import { ProfileStore } from "./services/profile.ts";
import { EvidenceStore } from "./services/evidence.ts";
import { OutreachService } from "./services/outreach.ts";
import { ReminderService } from "./services/reminders.ts";
import { Application, Job, OutreachMessage, Reminder } from "./domain.ts";

/**
 * Composition root: wire concrete adapters to services from a loaded config.
 * Everything under `workspace/` is personal state and gitignored.
 */
export function workspacePaths(config: Config) {
  const root = config._workspaceRoot;
  return {
    root,
    jobs: join(root, "jobs"),
    applications: join(root, "applications"),
    profile: join(root, "profile"),
    preferences: join(root, "profile", "preferences.json"),
    answers: join(root, "profile", "answers.json"),
    chat: join(root, "chat"),
    chatLog: join(root, "chat", "log.jsonl"),
    outreach: join(root, "outreach"),
    reminders: join(root, "reminders"),
    dossier: join(root, "dossier"),
    dossierIndex: join(root, "dossier", "index.json"),
  };
}

export async function ensureWorkspace(config: Config) {
  const paths = workspacePaths(config);
  for (const dir of [paths.root, paths.jobs, paths.applications, paths.profile, paths.chat, paths.outreach, paths.reminders, paths.dossier]) {
    await mkdir(dir, { recursive: true });
  }
  return paths;
}

export function makeServices(config: Config) {
  const paths = workspacePaths(config);
  const jobs = new JsonCollection<Job>({ dir: paths.jobs, entityName: "job", validate: (r) => Job.validate(r) });
  const applications = new JsonCollection<Application>({
    dir: paths.applications,
    entityName: "application",
    validate: (r) => Application.validate(r),
  });
  return {
    paths,
    config,
    jobs,
    applications,
    pipeline: new PipelineService({ jobs, applications, minMatchScore: config.minMatchScore }),
    chat: new ChatLog({ filePath: paths.chatLog }),
    profile: new ProfileStore({ dir: paths.profile }),
    evidence: new EvidenceStore({ jobs, applications, workspaceRoot: paths.root }),
    outreach: new OutreachService({
      messages: new JsonCollection<OutreachMessage>({
        dir: paths.outreach,
        entityName: "outreach message",
        validate: (r) => OutreachMessage.validate(r),
      }),
    }),
    reminders: new ReminderService({
      reminders: new JsonCollection<Reminder>({
        dir: paths.reminders,
        entityName: "reminder",
        validate: (r) => Reminder.validate(r),
      }),
    }),
  };
}

export type Services = ReturnType<typeof makeServices>;
