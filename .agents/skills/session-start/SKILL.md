---
name: session-start
description: Boot Aja at the start of any session — check missing candidate preferences, poll the chat queue, and load the pipeline state.
---

# Session start

Run the boot sequence from AGENTS.md in order:

```bash
node bin/axa.ts prefs missing
node bin/axa.ts chat poll --since 0 --wait 3
node bin/axa.ts pipeline
```

- For each missing preference key, ask the candidate (one compact block) and
  store every answer: `node bin/axa.ts prefs set <key> <value> --source chat`.
  Recommended keys: `companyType` (product-based vs service-based),
  `salaryFloor`, `workMode`, `locations`, `seniority`. Never invent values.
- Handle queued chat messages before anything else; acknowledge them in chat
  with `node bin/axa.ts chat reply`.
- If the dossier is configured but `dossier index` has never run, run it.

$ARGUMENTS
