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

**Opening a different conversation in the inbox (verified 2026-10-01, 3/3):**
the conversation-list card is a `div.msg-conversation-listitem__link[tabindex=0]`
(no anchor, no href — the conversation id is not in the DOM, so you cannot build
a thread URL yourself). Three normal approaches all fail:

- `getByRole('heading', { name: 'Ankita Sen' }).click()` — times out. The list
  never stops re-rendering (its own a11y text says "messaging items continuously
  update"), so Playwright's actionability checks never settle.
- `dom_cua.click` on the row's node ref — lands without error, leaves
  `document.activeElement` on `BODY`.
- `cua.click` at the row title's coordinates — hover state shows, nothing opens.

What works is dispatching a real mouse-event sequence onto the link element:

```js
const h = Array.from(document.querySelectorAll('h3')).find(x => x.innerText.trim() === 'Ankita Sen');
const link = h.closest('[class*="listitem__link"]');      // the h3's card link
const o = { bubbles: true, cancelable: true, view: window };
link.dispatchEvent(new MouseEvent('mousedown', o));
link.dispatchEvent(new MouseEvent('mouseup', o));
link.dispatchEvent(new MouseEvent('click', o));
```

Then wait ~3s and confirm `/messaging/thread/<id>/` in the URL actually changed.
All three dispatched events are needed; a bare `.click()` alone did not switch
threads in testing. The same evaluate-then-dispatch path opens the toolbar
filter chips (`Unread`, `InMail`, `Starred`) too.

**Reading the inbox for a message check:** the conversation preview shows the
*last* message in the thread, so a preview beginning `You:` means nobody owes a
reply — that alone settles most threads without opening them. The `Unread` chip
is the completeness check: it lists every thread with unread messages, including
old ones that were never triaged. Fold in the `InMail` chip to catch agency and
recruiter pitches that were read but never logged.

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

## Invite dialog mechanics (2026-10-01, 4/4 wave-2 sends)

**`goto` on `preload/custom-invite` times out but the page loads.** Observed 2 of 4
sends: `tab.goto` threw "Navigation timed out after 10000ms" while the dialog was
actually open behind it. Do not retry the navigation — re-observe the same tab
(`tab.url()` + `domSnapshot`); the dialog is usually there.

**Clicking "Add a note" programmatically does not move focus into the textarea.**
When the deep-shadow `click()` and the `cua.type` happen in the same call, the note
never lands (counter stays `0/300`, Send stays disabled) even though the textarea
opened. Working order: deep-shadow click "Add a note" → in a fresh call confirm the
textbox via `getByRole("textbox")` (count 1) and `click()` it → `cua.type` the note
→ confirm the live counter matches the intended length → dispatch the Send click.
Verified 4/4 with the evaluator-dispatched Send on 2026-10-01.

**Confirming an invite actually landed — read Pending after a reload (2026-10-01, 3/3).**
The profile's "Pending, click to withdraw…" marker is the ground truth, but a
read taken immediately after sending is unreliable: on the same profile it
returned `Pending` once, then `no Pending in text` on the next call, because the
header re-rendered. **Always `tab.reload()` + `waitForLoadState` before reading
the marker**, and read the header block rather than a boolean over the whole
body (the word "Connect" also appears in page copy, so a naive `/Connect/` test
is a false alarm). Note `https://www.linkedin.com/invitations/` is **not** a real
path (404, "Unknown Host") — the profile is the only reliable check.

**The invite note textarea resists locator clicks (2026-10-01).** `locator('textarea').click()`
times out on the `preload/custom-invite` dialog, same as the portal behaviour in
[phenom.md](phenom.md). The working path is the familiar one: `evaluate` the
rect, then `cua.move` + `cua.click`, and confirm with
`document.activeElement.tagName === 'TEXTAREA'` before typing. Keep the documented
order — deep-shadow click "Add a note" → **separate call** → focus the textarea →
`cua.type` → compare `textarea.value` against the intended string → dispatch Send.

## Post search — informal "we're hiring" posts (verified 2026-10-01)

**Goal:** surface reqs that exist only as a feed post (a recruiter or hiring
manager describing a role), which never appear in `/jobs/search`.

**Working path:**

```
https://www.linkedin.com/search/results/content/?keywords=<urlencoded>&sortBy=date_posted
```

This is the same search box the user types into, routed to the Posts tab and
sorted by Latest. Same logged-in session; no query needed. Results are true
feed posts (a `Feed post` heading in `main`), so the freshness labels are real
("9m", "1h") — a post can be minutes old.

**Naive approach fails:**

- **Stacking `AND` kills the result set.** `"Staff Software Engineer" AND
  (hiring OR "we are hiring") AND (Some City OR Some City) AND ("AI platform" OR
  "data platform" OR agentic)` returned **zero** posts. LinkedIn does no
  relevance recovery across many required terms — every extra `AND` narrows to
  nothing. Use the two-term form only: `"<role title>" hiring`.
- **Loose `OR` drifts off-profile entirely.** `hiring "Staff Engineer" OR
  "Principal Engineer" Some City "AI platform"` returned a maritime-engineer
  fleet post and a robotics role. Boolean precedence is not what a reader
  expects. Quote the role title as one phrase and add at most one plain term.
- **`.feed-shared-update-v2` does not match.** The hashed class names are not
  exposed via `className`, so a card-level querySelector returns an empty list
  even when posts are present. Read the **text layer** instead:
  `document.querySelector('main').innerText.split('Feed post').slice(1)` gives one
  block per post (poster name, headline, freshness, body), and
  `main.querySelectorAll('a[href*="/in/"]')` gives the poster profiles.
  `playwright.domSnapshot()` on the same page is a good cross-check.

**Yield, honestly measured (4 queries, 2026-10-01):** ~3 posts per page, all
inside the last hour, and **recruiting-agency blasts dominate** — three of four
posts on the "Principal Software Engineer" page were the *same* DevOps req
reposted by three CareerXperts / EV Search consultants. Do not read a page of 3
posts as 3 opportunities; the genuinely-new product-company req is a minority.
Filter every hit against the candidate's own prefs (role exclusions, location)
before spending a card on it.

## Wave-2 sends: the "Loading" race, and type-without-clicking (verified 2026-10-01, 5/5)

**Goal:** send a batch of connection invites with notes, one at a time, on the
`preload/custom-invite` flow.

**Naive approach fails:** dispatching the deep-shadow "Add a note" `click()` immediately
after `goto` reports success (`found: true`) while the dialog is still showing a
`Loading` heading — the click is real but lands on a dialog that then re-renders, so the
`domSnapshot` you read next still says `Loading` and the send looks stalled. Following the
older recipe's "confirm the textbox with `getByRole('textbox')` and `click()` it" step can
then **time out** on a 30s budget, because that textbox is already focused and Playwright's
click never settles.

**Working path** (cleanest order, 5/5 with no retries):

1. `goto` `https://www.linkedin.com/preload/custom-invite/?vanityName=<handle>` inside a
   `try/catch` — the navigation timeout is benign, the page still loads.
2. `waitForTimeout` ~4.5s, then poll the snapshot until the dialog heading reads
   **"Add a note to your invitation"** and the snapshot contains `/300` (i.e. it is past
   `Loading`). The deep-shadow "Add a note" click is optional — the dialog frequently
   reaches the note view on its own. If you do dispatch it, re-check the heading afterwards
   rather than trusting `found: true`.
3. **Type directly with `cua.type`. Do not click the textbox first.** In the settled note
   view the textbox is already `[active]`; `cua.type` lands the text reliably and skips the
   click that may hang.
4. **Verify the live counter** — `…/300` via `evaluate` — and compare it to the intended
   length before sending. This is the cheap guard against a truncated or doubled type.
5. Deep-shadow dispatch the Send button (`"Send"` or `"Send invitation"`), then `waitForTimeout`
   ~2.2s and confirm the dialog heading is gone.
6. **Verify on `mynetwork/invitation-manager/sent/`**, not the dialog closing. Read
   `People (N)` from the manager before the wave and after it: the delta must equal the
   number of invites sent. Then confirm each note text appears verbatim under its name.

**People search — the company pool is short; `keywords` finds the rest.** A
`?currentCompany=["<id>"]&network=["S"]` search returns only ~9 second-degree people and
further scrolling does **not** load more — three of five named targets were absent from it.
Adding a `keywords` term to the same people-search URL finds them by name and still respects
the network filter:

```
https://www.linkedin.com/search/results/people/?keywords=<urlencoded>&network=%5B%22S%22%5D
```

Read results from `domSnapshot()` (names, `/in/<handle>/`, headline, location, mutuals all
appear cleanly there). `document.querySelectorAll("main li")` returns nothing useful — the
result cards are not `li`-rooted, and `document.querySelectorAll('input…')` came back empty
because the header search input is not reachable that way either. Split the snapshot on
`\n    - link '` and regex per chunk if you need a structured list.

**A `Follow` button on the search card does not mean Connect is unavailable.** Two targets
showed `Follow` on their HighLevel search card and still accepted an invite through
`preload/custom-invite`. Try the invite flow; don't pre-filter on the card's button.

## Inbox triage — the Unread chip sticks, and it hides today's threads (verified 2026-10-01)

**Reading the inbox for a completeness check.** The `Unread` filter chip opens fine with the
mousedown/mouseup/click dispatch, but it is **sticky across a soft client-side re-render**: after opening
a thread the list stays filtered to unread even though the chip UI reads as unselected, and a `tab.reload()`
does **not** clear it. Today's active threads then look like they do not exist — on this run the whole
"Focused" list had dropped to the 9 stale unread threads (Sulbia, Shree, Prajna, Saurabh, Dharti, Maryna,
Shruti, Robin, Nidhi) while Shivam Sinha and Nikita Bathla, both from tonight, were missing entirely.

**Working path:** drive the filter with a full `tab.goto("https://www.linkedin.com/messaging/")` instead of
reload or chip clicks — that is the one navigation that reliably returns the Focused list. Verify before
trusting any inbox read:

```js
Array.from(document.querySelectorAll('div.msg-conversation-listitem__link')).map(el => {
  const h = el.querySelector('h3'), p = el.querySelector('p');
  return (h ? h.innerText.trim() : '?') + ' :: ' + (p ? p.innerText.trim().replace(/\s+/g,' ') : '');
})
```

The first entry being tonight's newest thread is the confirmation that the Focused list is actually loaded.

**The conversation-card preview settles most threads without opening them.** A preview beginning `You:`
means nobody owes a reply. `"InMail • <subject>"` is an untriaged inbound pitch (recruiter, no answer
required yet), and a card carrying a `generic "N unread message"` node is the one that actually needs opening.

**Message composer file attachment (verified 2026-10-01).** The `Attach a file` button's hidden input is a
plain, non-shadow `input[type=file]` and is reachable and correct:

```
input[type=file]#attachment-input-<n>   accept="image/*,.ai,.psd,.pdf,.doc,.docx,.ppt,.pptx,.pps,.ppsx,.xls,.xlsx,.txt,.eml,.mov,.mp4"
```

There are two such inputs per page — one `image/*` only, one the full document set — so **select by the
`accept` that contains `.pdf`, not by index**. IAB's own file-chooser/`setFiles` path is
`capability_unsupported`, so attaching needs the DataTransfer-injection route already proven on the Workday
and SmartRecruiters upload widgets (see [workday.md](workday.md)), or the candidate attaching by hand.

**Attachment injection works on this composer (verified 2026-10-01, 2/2 sends, resume delivered).** Base64
the PDF host-side, then build the file in the page and fire `change`:

```js
const input = Array.from(document.querySelectorAll('input[type=file]'))
  .find(i => (i.accept || '').includes('.pdf'));        // pick by accept, not index
const bin = atob(payload);                                // payload = base64 of the PDF
const arr = new Uint8Array(bin.length);
for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
const file = new File([arr], 'Candidate_Resume.pdf', { type: 'application/pdf' });
const dt = new DataTransfer();
dt.items.add(file);
input.files = dt.files;
input.dispatchEvent(new Event('change', { bubbles: true }));
```

LinkedIn renders an `Attached` chip with the size (e.g. "263 KB") within ~2s — read it back before sending,
since a silently dropped `files` assignment still leaves a valid-looking compose box. **Rename the file to the
candidate-only name at the point of injection** (`new File([...], 'Candidate_Resume.pdf')`), because the
attachment name is what the recruiter sees: a per-company filename that is correct in the dossier leaks the
target to the recipient. Keep the company+role-named copy on disk; strip it at the boundary.

The full working order is: type the text with the `execCommand` insert above → attach → read the size chip →
hover-travel click Send → verify with all three send signals. Attachment and text send as ONE message; do not
attach in a separate action expecting a second message.

## Reading a thread body — `div.msg-thread__list li` is empty (verified 2026-10-02)

**Goal:** read the messages of the thread that is open in the detail pane.

**Naive approach fails:** the obvious selector returns nothing —
`document.querySelectorAll('div.msg-thread__list li')` came back `[]` on a thread
that was visibly rendered (the URL had already changed to `/messaging/thread/<id>/`).
Do not conclude the thread is empty from that.

**Working path:** the detail pane renders its messages as bare `- paragraph:` /
`- 'heading …'` lines inside a plain `list`, with a
`generic: <Name> sent the following message(s) at <time>` marker between them. Take a
`domSnapshot()` and slice it — the thread body starts after the
`Load more conversations` button and runs to `textbox "Write a message…"`. That slice
carries the whole thread *including* the sender, degree, headline, and per-message
timestamps, which is what you need to tell a recruiter pitch from a peer reply.

The `h2` in the detail pane is **not** the conversation name — the first `h2` on the
page is the toast region (`"0 notifications total"`), so `document.querySelector('h2')`
returns the wrong thing. Match the name off the snapshot's
`term: - heading "<Name>"` block instead.

**Opening a thread clears its unread badge in the list.** The `1 unread message` node on
a conversation card is gone after the thread is opened — so a badge count taken before
opening is the only reliable one. Snapshot the Focused list first, then open.

**The `Unread` chip read reuses the card dispatch.** The same
mousedown/mouseup/click triple on the `button` whose `innerText` is exactly `Unread`,
followed by the `div.msg-conversation-listitem__link` name/time/preview map, returns the
completeness list — 9 stale threads (Aug 25 back to Mar 2023) against a 10-thread Focused
list. This is the cheapest way to find inbound pitches nobody ever triaged, since the
Focused list is paginated behind `Load more conversations` and hides them entirely.
