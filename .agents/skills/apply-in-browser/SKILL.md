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
3. Never guess identity, legal, authorization, or compensation fields. For
   unknown ones, ask in chat (`chat reply`), wait for the candidate, apply the
   answer, then persist it: `node bin/applymate.ts answers set "<question>" "<answer>"`.
4. **Pace yourself like the person you are acting for.** One session, one tab
   per site; let pages load and scan them before acting; move through
   multi-page flows (Next / Save & Continue) in order with natural pauses;
   type field by field with small pauses and the occasional correction instead
   of instant field-stuffing; no parallel sessions or batch-blasting.
5. If a CAPTCHA, human-verification challenge, or block page appears, stop and
   hand it to the candidate. Never bypass, solve, or disguise your way around
   one — no stealth plugins, fingerprint spoofing, or proxy tricks, ever. If a
   site rejects automation, that site belongs to the candidate.
6. Keep a running log in `workspace/applications/<appId>/notes.md`: pages
   completed, anything odd, where you stopped.
7. At the final Submit: stop and ask the candidate for an explicit yes. Only the
   candidate submits.
8. **The moment it goes through, preserve the proof:** screenshot the
   confirmation/submit page and store it:
   `node bin/applymate.ts app evidence <appId> submit.png --kind submit-screenshot`.
   If a confirmation number is shown, capture it too (`--kind confirmation`)
   and note it in chat.
9. Record the facts: `node bin/applymate.ts app submitted <appId> --portal "<portal>"
   --confirmation "<number if any>"` — this stamps the exact submission time
   and moves the application to `submitted`.

$ARGUMENTS
