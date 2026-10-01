# linkedin.com — browsing recipes

Recipes for driving linkedin.com with harness browser tools: messaging,
connection invites, job-card interactions, verification discipline. Format
and ground rules: [README.md](README.md). Human pacing and the no-evasion
rules in AGENTS.md govern everything here — a widget that still refuses
after the recipe goes to the candidate.

## Messaging (threads + compose overlay)

**Goal:** open a conversation, type into the compose box, send.

**Naive approach fails:** the inbox search/pager misbehaves; Playwright
locator clicks on the messaging page time out; `cua.type`/`dom_cua.type` do
NOT reach the contenteditable compose editor; `dom_cua` node clicks and
Enter are ignored by the overlay's React handler.

**Working path:**

- To open a conversation even when inbox search misbehaves, go to the
  profile and use its Message link target directly:
  `/messaging/compose/?profileUrn=urn%3Ali%3Afsd_profile%3A<urnId>&recipient=<urnId>&screenContext=NON_SELF_PROFILE_VIEW&interop=msgOverlay`
  — it renders the full thread plus the compose box.
- Reading is easy: the ARIA snapshot sees everything. Acting is not: keep
  `domSnapshot` for ground truth, get node refs from
  `dom_cua.get_visible_dom()` and click those.
- **Typing into the compose box** (verified 2026-10-01): `playwright.evaluate`
  → focus `div[role="textbox"][aria-label="Write a message…"]` →
  `document.execCommand("insertText", false, text)`. The draft persists
  server-side, so a failed send survives a reload of the compose URL.
  `button[type=submit]` (Send) may read `disabled` immediately after the
  insert — that is a stale read, not a dead draft; re-read a beat later (or
  after a ~300 ms wait) before concluding anything.
- **Sending:** use the hover-travel + click recipe (see Connection invites
  below): read the Send button's center via `evaluate`
  (`button[type=submit]` in the message form), `cua.move` through 3–4
  converging points with ~250–300 ms pauses, hold ~550 ms, then `cua.click`;
  verify the text moved from the compose box into the thread.
- **Verifying a send — the false positive to avoid** (learned 2026-10-01): a
  text match on the `domSnapshot` can hit the *compose box* (your own unsent
  draft) and look like a delivered message. Verify with all three signals:
  (1) a thread marker line "… sent the following message at <time>",
  (2) the compose box `textContent` length now 0, (3) Send `disabled` again.
  Overlay timestamps can render in a shifted timezone — the marker plus empty
  compose is the ground truth, not the wall-clock time shown.
- **Send click silently eaten** (2026-10-01, 2× on a fresh compose render):
  hover-travel + dwell clicks left the draft in the compose box with no error.
  The working fallback is the field-note remedy: `evaluate`-dispatch the
  button's own `click()` (`document.querySelector('button[type="submit"]').click()`),
  then re-verify with the three signals above.

## Connection invites ("Add a note to your invitation?")

**Goal:** send a connection invite with a note.

**Naive approach fails:** the dialog renders in closed shadow DOM —
`evaluate` can't see it (the ARIA snapshot and screenshots are the ground
truth). Bare `cua.click` at button coordinates is **silently ignored** — so
are `dom_cua` node clicks and Enter/Space on the focused button.

**Working path** (verified 3/3 on referral invites, 2026-09-28):

1. Navigate straight to
   `https://www.linkedin.com/preload/custom-invite/?vanityName=<handle>`
   (the dedicated invite page; the dialog auto-opens).
2. **Wait until the ARIA snapshot confirms the dialog text before clicking**
   (it can render late).
3. **Hover-travel then click:** `cua.move` through 3–4 intermediate points
   converging on the button with ~250–300 ms pauses, hold on target
   ~550 ms, then `cua.click`.
4. The note textarea opens auto-focused; `cua.type` lands the note (char
   counter confirms), then hover-travel + click "Send" and verify the
   profile shows "Pending, click to withdraw invitation sent to …".

The same hover-then-click pattern is worth trying on any portal that ignores
bare clicks. This is human pacing, not evasion — if a widget still refuses,
stop and hand it to the candidate.

**"Add a note" button eats coordinate clicks — deep shadow-DOM fallback**
(verified 2026-10-01, 3/3 sends): on the `preload/custom-invite` dialog, the
"Add a note" button ignored hover-travel + `cua.click` twice in a row. The
working fallback: `evaluate` a recursive walk that descends into every
element's `shadowRoot` (the artdeco roots are open even when the recipe above
calls the dialog "closed shadow DOM" for snapshot purposes), collect `button`
/ `[role=button]` nodes, find the one whose `textContent` trims to the exact
label ("Add a note", then "Send"), and dispatch its own `.click()`. Verify
each step from the ARIA snapshot (textarea appears, counter fills, dialog
closes), and on the profile afterwards the "Pending, click to withdraw
invitation sent to …" marker is the ground truth.

**Invite-note length cap is 300 even on Premium** (verified 2026-10-01): the
dialog shows "You have unlimited notes with Premium", but that refers to note
quantity — the editor counter still enforces `0/300`. Target ≤300 chars for
every connection note regardless of plan, and read the live counter before
typing rather than budgeting ~500.

## Job-card interactions (search results, saved lists)

**Naive approach fails:** the card grid has **Dismiss** buttons flush
against each card; a card click that lands a few pixels off — or an
automated click loop sweeping the grid — can silently dismiss postings
(observed in the field: a run of card clicks hit neighboring Dismiss
buttons before being caught).

**Working path:** aim card clicks at the card's title/link region, not the
card edges; after any bulk card interaction, re-verify the list's state
(the undo toast is ephemeral).

## Reading a job description (logged-in) — the empty detail page

**Goal:** capture the full JD text of a `/jobs/view/<id>/` posting.

**Naive approach fails** (verified 2026-10-01, Chrome/IAB logged-in
session): the standalone `https://www.linkedin.com/jobs/view/<id>/` page
renders only the header card (title, company, location, Easy Apply/Save);
the description module never mounts — reloads and waits don't help
(`document.body.innerText` stays ~1.4k chars, no `.jobs-description` node
in the DOM at all). The two-pane search layout
(`/jobs/search/?currentJobId=<id>`) also fails: LinkedIn ignores the
`currentJobId` param and shows a default result list ("Jobs in Ireland")
with no detail pane.

**Working path:** the public, unauthenticated guest endpoint returns the
full posting HTML with no login:
`https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/<id>` — the
description is in `.show-more-less-html__markup`. Use it for the JD text
(and save the response HTML as `--kind jd-snapshot` evidence); use the
logged-in `/jobs/view/<id>/` page only for the header screenshot
(`--kind jd-screenshot`, it shows the Easy Apply button and applicant
count). Verified 2026-10-01 on job 4474128132 (Hiver).

## Verification discipline (learned from silent failures)

LinkedIn sometimes drops an action silently — an invite that shows no error
but never lands — and stale UI (e.g. an old messaging bubble) can make a
page look like a dialog is open when it is not. Trust the ARIA/dom snapshot
over visuals, and re-verify the action's real state (the profile "Pending"
flag, the invitation manager, the thread contents) before retrying.
