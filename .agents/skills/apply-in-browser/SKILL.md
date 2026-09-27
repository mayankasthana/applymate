---
name: apply-in-browser
description: Fill a job application in a web portal using the harness browser tools, the stored form-answer memory, and candidate confirmations.
---

# Apply in the browser

Use the harness's browser/computer-use tools when available. Without them,
prepare answers and ask the candidate to drive while you coach.

1. Open the application portal for the tracked `<appId>` (see its `notes.md`
   artifact for the URL and any portal quirks).
2. Load the form memory first: `node bin/axa.ts answers list`. For each field,
   `node bin/axa.ts answers get "<question>"`. Fill only what is known.
3. Never guess identity, legal, authorization, or compensation fields. For
   unknown ones, ask in chat (`chat reply`), wait for the candidate, apply the
   answer, then persist it: `node bin/axa.ts answers set "<question>" "<answer>"`.
4. Work through multi-page flows (Next / Save & Continue). Keep a running log
   in `workspace/applications/<appId>/notes.md`: pages completed, anything odd,
   where you stopped.
5. At the final Submit: stop and ask the candidate for an explicit yes. Only the
   candidate submits.
6. After submission: `node bin/axa.ts app move <appId> submitted --note "<portal> <date>"`.

$ARGUMENTS
