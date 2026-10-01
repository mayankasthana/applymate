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

## Portal quirks learned in the field

- **Phenom portals (jobs.autodesk.com "pcsx" apply flow).** React app; hidden
  `<input type=file>` is not framework-bound and a DataTransfer + change/drop
  does nothing. The uploader is an antd Upload whose `beforeUpload` swallows
  synthetic input silently. Working resume-upload path: read the PDF in Node,
  base64 it, then in one `evaluate` call build a `File`, walk the input's React
  fiber (`__reactInternalInstance$…`) up to the antd Upload fiber
  (`memoizedProps.beforeUpload`), and call its `stateNode.post({ origin, parsedFile,
  action, data })` directly — the XHR hits `/api/application/v2/resume_upload`
  and the server parses + attaches the resume to the candidate session
  (`profile` API shows `hasResume`/`resumeFilename`). Reload the page afterwards:
  the UI chip appears and parsed contact fields autofill. **Reloading clears the
  question answers** (contact refills; dropdowns don't) — re-answer after any
  reload, and never reload between staging and Submit. Playwright locator clicks
  time out on these portals (constant micro-renders): read rects via `evaluate`
  and click via `cua` coordinates.
- **LinkedIn messaging (threads + compose overlay).** To open a conversation
  even when the inbox search/pager misbehaves, go to the profile and use its
  Message link target directly:
  `/messaging/compose/?profileUrn=urn%3Ali%3Afsd_profile%3A<urnId>&recipient=<urnId>&screenContext=NON_SELF_PROFILE_VIEW&interop=msgOverlay`
  — it renders the full thread plus the compose box. Reading is easy: the ARIA
  snapshot sees everything. Acting is not: Playwright locator clicks on the
  messaging page time out (keep `domSnapshot` for ground truth, get node refs
  from `dom_cua.get_visible_dom()` and click those). **Typing into the
  compose box:** `cua.type`/`dom_cua.type` do NOT reach the contenteditable
  editor. Working path (verified 2026-10-01): `playwright.evaluate` → focus
  `div[role="textbox"][aria-label="Write a message…"]` →
  `document.execCommand("insertText", false, text)`. The draft persists
  server-side, so a failed send survives a reload of the compose URL.
  **Sending:** `dom_cua` node clicks and Enter are ignored by the overlay's
  React handler. Use the hover-travel + click recipe above: read the Send
  button's center via `evaluate` (`button[type=submit]` in the message form),
  `cua.move` through 3-4 converging points with ~250-300 ms pauses, hold
  ~550 ms, then `cua.click`; verify the text moved from the compose box into
  the thread.
- **LinkedIn (profile invite dialogs, "Add a note to your invitation?").** The
  dialog renders in closed shadow DOM: `evaluate` can't see it; the ARIA
  snapshot and screenshots are the ground truth. Bare `cua.click` at button
  coordinates is **silently ignored** — so are `dom_cua` node clicks and
  Enter/Space on the focused button. What works (verified 3/3 on the referral
  invites, 2026-09-28): navigate straight to
  `https://www.linkedin.com/preload/custom-invite/?vanityName=<handle>` (the
  dedicated invite page; the dialog auto-opens), **wait until the ARIA snapshot
  confirms the dialog text before clicking** (it can render late), then
  **hover-travel then click**: `cua.move` through 3-4 intermediate points
  converging on the button with ~250-300 ms pauses, hold on target ~550 ms,
  then `cua.click`. The note textarea opens auto-focused; `cua.type` lands the
  note (char counter confirms), then hover-travel + click "Send" and verify the
  profile shows "Pending, click to withdraw invitation sent to …". Same
  hover-then-click pattern is worth trying on any portal that ignores bare
  clicks. This is human pacing, not evasion — if a widget still refuses, stop
  and hand it to the candidate.

$ARGUMENTS
