---
name: apply-in-browser
description: Fill a job application in a web portal using the harness browser tools, the stored form-answer memory, human-paced actions, and candidate confirmations.
---

# Apply in the browser

The browser is the default way to apply. Use the harness's browser/computer-use
tools when they exist. Without them, prepare answers and ask the candidate to
drive while you coach.

1. Open the application portal for the tracked `<appId>` (see its `notes.md`
   artifact for the URL and any portal quirks).
2. Load the form memory first: `node bin/applymate.ts answers list`. For each field,
   `node bin/applymate.ts answers get "<question>"`. Fill only what is known.
   Free-text answers you compose (essays, "why this role", summaries) are
   drafted from dossier facts and passed through the `humanizer` skill before
   they go into the field — no AI-sounding prose under the candidate's name.
3. Portal form state rarely survives between sessions — on a return visit,
   expect to refill. If the portal parses resumes (SmartRecruiters, Workday,
   Greenhouse do), upload the resume PDF first and let the parser autofill
   experience and education, then patch the gaps by hand. In-app browsers
   cannot drive the OS file picker; the working path is the page's own upload
   widget: locate the `<input type="file">` (often inside open shadow DOM) and
   set `files` via a `DataTransfer`, or dispatch a synthetic `drop` event
   carrying a `DataTransfer` with a `File` onto the drop zone — either lands
   the file and triggers the site's parse. Verify every parsed field against
   the approved resume before moving on (parsers drop months, merge words).
4. Never guess identity, legal, authorization, or compensation fields. For
   unknown ones, ask in chat (`chat reply`), wait for the candidate, apply the
   answer, then persist it: `node bin/applymate.ts answers set "<question>" "<answer>"`.
5. **Pace yourself like the person you are acting for.** One session, one tab
   per site; let pages load and scan them before acting; move through
   multi-page flows (Next / Save & Continue) in order with natural pauses;
   type field by field with small pauses and the occasional correction instead
   of instant field-stuffing; no parallel sessions or batch-blasting.
6. If a CAPTCHA, human-verification challenge, or block page appears, stop and
   hand it to the candidate. Never bypass, solve, or disguise your way around
   one — no stealth plugins, fingerprint spoofing, or proxy tricks, ever. If a
   site rejects automation, that site belongs to the candidate.
7. Keep a running log in `workspace/applications/<appId>/notes.md`: pages
   completed, anything odd, where you stopped.
8. At the final Submit: stop and ask the candidate for an explicit yes. Only the
   candidate submits.
9. **The moment it goes through, preserve the proof:** screenshot the
   confirmation/submit page and store it:
   `node bin/applymate.ts app evidence <appId> submit.png --kind submit-screenshot`.
   If a confirmation number is shown, capture it too (`--kind confirmation`)
   and note it in chat.
10. Record the facts: `node bin/applymate.ts app submitted <appId> --portal "<portal>"
   --confirmation "<number if any>"` — this stamps the exact submission time
   and moves the application to `submitted`.

## Portal mechanics — the recipe library

Hard-won portal mechanics (resume-upload workarounds, reload behavior,
click fallbacks, LinkedIn messaging/invite recipes) live in the committed
library `docs/portal-recipes/` — one file per site family, indexed in its
README. **Read the file for this portal before opening the portal**, and
after any difficulty you solve in here, write the recipe back into that
library and commit it (`docs(recipes): <domain> — <what was learned>`).
The AGENTS.md "Browser recipes" section is the standing rule: never
re-derive what the library already knows, never fork a second copy.

$ARGUMENTS
