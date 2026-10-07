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
- **Send click silently eaten** (2026-10-01, 2× on a fresh compose render; again
  2026-10-04 on a reply carrying an attachment; and **2/2 again on 2026-10-05 —
  one text+attachment, one plain text with no attachment at all** — so it is
  neither a fresh-render-only bug nor attachment-specific. Treat the
  hover-travel click as a first attempt, not the working path, and fall through
  to the evaluate-dispatch immediately):
  hover-travel + dwell clicks left the draft in the compose box with no error.
  The working fallback is the field-note remedy: `evaluate`-dispatch the button's
  own `click()`, then re-verify with the three signals above. Scope the lookup to
  the compose form — `button[type=submit]` alone also matches the send-options
  button sitting beside it:
  ```js
  const box = document.querySelector('div[role="textbox"][aria-label="Write a message…"]');
  const form = box.closest('form');
  const btns = Array.from(form.querySelectorAll('button'))
    .filter(b => b.type === 'submit' && /Send/.test(b.innerText || b.getAttribute('aria-label') || ''));
  if (btns.length !== 1) throw new Error('send btn count ' + btns.length);
  btns[0].click();
  ```
- **Assert on the *new* marker, not on a marker matching your own name** (learned
  2026-10-04): after the eaten click, `body.innerText` still matched
  `Candidate Name sent the following message` — that was the *earlier* message in
  the same thread, and reading it as success would have called a failed send
  delivered. Take the full match list, confirm the count went up and the newest
  timestamp is the one just sent. The attachment bubble
  (`PDF <name> 263 KB Download`) is the strongest single signal that a
  text+attachment message actually left the composer.

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

**A non-`You:` preview is NOT proof a reply is owed (verified 2026-10-03).** The
preview line falls back to the thread's InMail *subject* when the sender's card
is a recruiter pitch, so an InMail thread shows the agency's headline
("Exciting Opportunity Senior Backend Engineer…") as the last line even after you
have replied yourself. Two threads on the 2026-10-03 check read as inbound and
were both outbound: the recruiter had replied in August, and the candidate's own
recent message (with the resume attached) was the newest thing in the thread.
**Open every non-`You:` thread before calling it owed** — the subject-line
echo is the tell. Real inbound, once read, carries a
`generic: <Name> sent the following message(s) at <time>` marker after your own.

**The filter pills are `visibility-hidden` and `innerText`-blank — target the
data attribute (verified 2026-10-03).** The recipe above finds the chips by
`button` whose `innerText.trim() === 'Unread'`. That no longer matches: the chips
now live in a `div[role=radiogroup][data-test-messaging-inbox-filters__filter-pill-group]`
and each one carries `class="... visibility-hidden"`. `innerText` follows
rendering, so a hidden element returns `""` and a text-equality search finds
**nothing** — which looks exactly like "the chip is not on the page" and invites
a false "no unread messages" conclusion. Select on the stable attribute instead:

```js
// available pills: JOB, UNREAD, CONNECTIONS, INMAIL, STARRED
const b = document.querySelector('button[data-test-messaging-inbox-filters__filter-pill="UNREAD"]');
const o = { bubbles: true, cancelable: true, view: window };
b.dispatchEvent(new MouseEvent('mousedown', o));
b.dispatchEvent(new MouseEvent('mouseup', o));
b.dispatchEvent(new MouseEvent('click', o));
```

Verify the filter actually engaged by reading the pressed state back —
`document.querySelector('button[data-test-messaging-inbox-filters__filter-pill][aria-pressed="true"]')`
— before trusting the thread list it produced. A locator `click()` on the
`Focused` folder dropdown still times out (the re-render problem); the dispatched
triple is the working path for both the folder pills and the dropdown.

**Verify the folder, not just the URL.** `https://www.linkedin.com/messaging/`
returns the Focused list, but a filter pill set earlier in the session can persist
across a `goto` and silently re-apply. Read `aria-pressed="true"` on the pill
group (or the `Focused` trigger's text) in the same evaluate that reads the
threads, so the report can state which list it actually read.

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

**The JD endpoint needs no browser at all — curl it (verified 2026-10-04,
job 4465911864 / JPMorgan Chase).** This is the cheap half of the entry above
and it is worth separating out: unlike the *search* endpoint further down (which
must be fetched from page context so it runs same-origin with the session), the
`jobPosting` endpoint answers a plain unauthenticated `curl` with a browser UA:

```bash
curl -sL --max-time 25 -A "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) \
AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36" \
  "https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/<id>" -o jd.html
# HTTP 200, ~68 KB, description present in .show-more-less-html__markup
```

So capturing a JD for an id you already have costs no browser round-trip — no
`goto`, no wait, no screenshot-cell budget. Only spend the browser on the header
screenshot, which genuinely does need the logged-in session.

**Applicant counts differ by source — they are not the same number.** On the same
posting the guest endpoint's `topcard__flavor` spans read `74 applicants` while the
logged-in header read `79 people clicked apply`. Same run, minutes apart: the
guest value is a server-rendered applicant count, the header value is LinkedIn's
own "people clicked apply" metric and it moves live. Quote one with its label
attached; do not treat a difference between them as a bug or silently prefer the
rounder-looking one.

Parsing notes for this endpoint: the description is one
`.show-more-less-html__markup` block, but the **company and location regexes
both false-positive** — `topcard__org-name-link` does not always match and the
`top-card-layout__first-subline` fallback returns the *company name*, not the
location. Read location by iterating every `topcard__flavor` span and discarding
the one equal to the company. The same span family also carries the posted-age
and applicant strings, so one loop over `topcard__flavor` yields company,
location, age and applicant count together.

## Sweeping new postings — the classic search UI is retired (verified 2026-10-03)

**Goal:** find everything posted in the last week matching a role + location,
from a logged-in IAB session.

**Naive approach fails — the whole page is dead, three separate ways** (IAB,
logged-in session, `https://www.linkedin.com/jobs/search`):

- **`domSnapshot()` times out** every time (>32 s). The page is too heavy for
  the ARIA snapshot; there is no snapshot-based locator ground truth to work
  from. Read the text layer via `evaluate` instead.
- **There are no keyword or location inputs at all.** A full shadow-DOM walk
  returns `input[type=text]` count **0** — not hidden, absent. The page
  renders the results list and the `Show filters` button and nothing else.
- **`Show filters` ignores every click technique**: locator `click()` times
  out on actionability, and `cua.move` + hover-travel + `cua.click` at the
  measured button centre (133, 80) leaves the panel closed with no error.
  The page banner explains why: *"We're gradually retiring classic job
  search starting in September."*

The default landing view is also useless as a source: "Jobs in India,
264,445 results", and **7 of the first 8 cards are `Promoted`** postings.
Reading that page as "what's new on LinkedIn" produces agency and paywalled
ads, not reqs.

**Working path — the guest search endpoint, same family as the JD endpoint
above.** It is LinkedIn's own search backend, needs no login, and returns
10 cards per request:

```
https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search
  ?keywords=<urlencoded role terms>
  &location=<urlencoded location>
  &f_TPR=r604800        # past week (r259200 = 3d, r86400 = 24h)
  &start=0              # 0, 25, 50 … paging
```

Fetch it from the page context so it runs same-origin with the session:

```js
const r = await fetch(url, { headers: { 'Accept': 'text/html' } });
const html = await r.text();
```

**Parse with regex, not `DOMParser`** — verified: `new DOMParser()
.parseFromString(fragment, 'text/html').querySelectorAll('li')` returns **0**
on this response (a 30 KB body with no list items), because the fragment is a
bare `<li>` run with no document context. Splitting the raw string works:

```js
html.split('<li>').slice(1).map(li => ({
  title:    strip(li.match(/base-search-card__title[^>]*>([\s\S]*?)</)?.[1]),
  company:  strip(li.match(/base-search-card__subtitle[\s\S]{0,300}?>([\s\S]*?)<\/h4>/)?.[1]),
  location: strip(li.match(/job-search-card__location[^>]*>([\s\S]*?)</)?.[1]),
  when:     strip(li.match(/job-search-card__listdate[^>]*>([\s\S]*?)</)?.[1]),
  id:       li.match(/href="([^"]*\/jobs\/view\/[^"]*)"/)?.[1]?.match(/-(\d{9,11})\?/)?.[1]
}))
```

The `company` capture needs a bounded `[\s\S]{0,300}?` — the subtitle anchor
can carry attributes long enough to blow an unbounded lazy match. The job id
is the trailing digit run before `?` in the card href.

**Two constraints that cost real time:**

- **One `evaluate` cell ≈ one or two requests.** `playwright.evaluate` is
  capped at 3000 ms, so a loop of 8 fetches with 900 ms pacing between them
  returns `{jobs: []}` — a *silent empty result*, not a timeout error. That
  reads exactly like "no new jobs today". Batch 2 requests per cell.
- **The guest endpoint working is NOT the company's liveness check.** A 200
  here only means LinkedIn still lists the posting. Several boards disagree
  with the aggregator's location: the Coupang req listed on LinkedIn as
  `Bengaluru, Karnataka, India` appears on `coupang.jobs` only as
  **Singapore** ("Staff Backend Engineer", Bengaluru is a listed location but
  a different req). Run the `prefs livenesscheck` pass on the company board
  before staging anything.

**Company boards that need the browser, not curl:** `coupang.jobs` returns
403 to plain HTTP, and `careers.equinix.com/job-search` 404s. Ashby's public
API 404s on guessed board slugs (`rippling`, `toast` are both wrong) — find
the slug from the careers page rather than composing it.

**Yield:** ~60 unique cards across 6 keyword/location pairs, of which 14
survived the candidate's prefs filter (product company, Staff+, no DevOps,
no ML/DS-titled, not already on the board). Treat LinkedIn as a *discovery*
surface only — every req still needs its JD pulled from the guest posting
endpoint and liveness-checked on the company board.

**Re-verified 2026-10-04** — the recipe above held exactly as written. 8
keyword/location pairs (2 per `evaluate` cell) returned 100 cards; 7 were
already on the board by LinkedIn job id, and a **company+title fuzzy dedupe
caught a further ~20 that the id check missed**, because the same req is
mirrored under different ids (e.g. Extreme Networks 10356 vs 10357/8/9, all
four on the board already). Do the id check *and* the company+title check;
the id check alone would have re-added five Extreme siblings.

**Re-verified 2026-10-05 — the company+title fuzzy dedupe needs word-boundary
safety.** Exact-pair matching after stripping trailing req ids (`-10356`,
`(On-site)`, `(Bengaluru)` — the same req mirrors under different LinkedIn ids
with location/req suffixes) catches most mirrors, but a bare character-prefix
match (`title[:30]`) false-positives in both directions: Amazon "Device Cloud
Core Services" matched the boarded "Delivery Experience (DEX)" req because both
normalize to `principal software engineer dev…`, and generic titles bare
("Principal Software Engineer", "STAFF, SOFTWARE ENGINEER") matched *longer*
boarded titles that are different reqs entirely. Working rule: exact normalized
pair = dupe; otherwise prefix-match on the first 4 **words** only when the
candidate title has ≥5 words; when in doubt, restore — a re-added req costs the
candidate one ✕ click on the card, a hidden one is never seen. Same sweep:
8 pairs → 80 cards → 34 deduped → 24 prefs-filtered → 22 new. The guest
`jobPosting` curl loop held at ~2 s pacing across 22 fetches; each response
filed directly as `jd-screenshot` evidence (html is an accepted evidence
format), which keeps the browser free during the sweep.

**Keyword pairs that actually produced agentic/AI-platform hits** (the
candidate's on-profile area) — worth repeating on a future sweep:
`Staff Engineer AI platform` + Bengaluru, and the generic
`Distinguished Engineer` + India. The plain `Staff Software Engineer` +
Bengaluru sweep returned mostly Node.js/Golang/kernel reqs with no AI layer.
Conversely `&f_WT=2` (remote) returned heavy Chennai/Pune noise.

**Screenshot loop times out — one `goto` + screenshot per cell.** Six
`goto`+`screenshot` pairs in a single `js` cell aborted on timeout. Two per
cell is the reliable ceiling, same root cause as the 3000 ms `evaluate`
cap. Screenshots must also be emitted with
`nodeRepl.emitImage(await tab.screenshot())` in the same cell — returning
the `Uint8Array` (or writing it to disk alone) fails with `UnknownVizError`.

**Applicant counts are readable from the detail page's text layer** — a
useful competition signal the search cards don't carry:
`/Over ([\d,]+) applicants?/`. EnCharge's 92/100 req showed "Over 100
applicants" ~1 day after repost; Equinix's showed 100. Worth reporting
alongside the score, since it changes whether a referral is the only lever.

## Verification discipline (learned from silent failures)

LinkedIn sometimes drops an action silently — an invite that shows no error
but never lands — and stale UI (e.g. an old messaging bubble) can make a
page look like a dialog is open when it is not. Trust the ARIA/dom snapshot
over visuals, and re-verify the action's real state (the profile "Pending"
flag, the invitation manager, the thread contents) before retrying.

## Invite dialog mechanics (2026-10-01, 4/4 wave-2 sends)

**The light-DOM textarea is a 0×0 template element — scan for VISIBLE controls only**
(verified 2026-10-04, 2/2 DE Shaw-wave sends). On `preload/custom-invite`, the note view
starts CLOSED: a naive `document.querySelector('textarea')` finds a hidden 0×0 template
textarea even before "Add a note" is clicked, and its zero-size rect baits a coordinate
click at (0,0) — which lands outside the modal and **silently dismisses it** (page falls
back to the bare messaging overlay; the preload URL stays in the address bar). The safe
scan walks shadow roots AND filters by `getBoundingClientRect().width > 10` for both the
TEXTAREA and the Send/Add-a-note/Connect buttons. Correct order: scan → click the visible
"Add a note" button (evaluator `.click()`) → re-scan → `cua.click` the now-visible
textarea's center → assert `document.activeElement.tagName === 'TEXTAREA'` → `cua.type` →
compare `textarea.value` + live counter (`288/300`, `255/300` verified) → evaluator-dispatch
the single "Send invitation" button (assert count 1 first) → confirm the dialog heading is
gone → reload the profile and read the **Pending** marker as ground truth.

**The dialog expires during long pauses.** A >30s gap between opening the dialog and the
first action (harness timeout, slow call) can leave the modal gone by the time you act —
the page text then shows no "Add a note" heading and no visible textarea. Re-observe before
every step; if the state doesn't match what the recipe says it should be, re-open from the
preload URL rather than acting on stale assumptions.

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

**`input.files.length === 0` right after the dispatch is NOT proof of failure (verified 2026-10-02).** This is
the inverse of the warning above and it cost a wasted second injection. LinkedIn's change handler **consumes
and resets the input**: read it back immediately after assigning and you get

```
dt.files.length      -> 1
input.files.length   -> 1     (assignment itself works)
... after dispatchEvent(change) ...
input.files.length   -> 0     (handler consumed it — attachment is fine)
```

So the only trustworthy read is the **`Attached` chip in the compose area**
(`figure "Candidate_Resume.pdf • 277 KB Attached"`). Check the chip, never the input.

**Re-running the injection silently attaches a SECOND copy** (observed: two identical chips). The chip count is
the dedupe check before sending — if it is >1, click
`button "Remove attachment <filename>"` (a plain locator click works on that button, unlike Send) until exactly
one remains. Dedupe *before* sending; you cannot unsend a duplicate attachment.

**Read the send button by its own name, not by `button[type=submit]` alone.** The composer has two submit-ish
buttons and the send-options one sits beside it. Scope to the compose form
(`document.querySelector('div[role="textbox"][aria-label="Write a message…"]')?.closest('form')`) and match
`aria-label`/`innerText === 'Send'` with `b.type === 'submit'`, then dispatch its own `.click()`.

**Scope the dedupe check to the composer — a body-wide filename scan counts the THREAD (verified 2026-10-05).**
The "chip count is the dedupe check" rule above is right, but the obvious
implementation is wrong when you are **re-sending** a file that is already in the
conversation: a `document.body.innerText.match(/<resume-name>/g)` on a re-send
returns one hit for the compose chip **and one for the earlier bubble still in
the thread**, so it reads as a duplicate when there is exactly one attachment.
The second send was nearly withheld over a phantom double-attach. Two fixes,
either fine:

```js
// chip count — the `figure` only exists for a live attachment
Array.from(document.querySelectorAll('figure'))
  .map(f => f.innerText).filter(t => t.includes('Resume'))   // -> 1

// or walk up from the composer to the SMALLEST ancestor that mentions the file.
// Keep the first match and BREAK — overwriting on every match walks all the way
// up to <body> and matches the whole page, which is the same false positive again.
let c = box.closest('form'), best = null;
for (let i = 0; i < 10 && c; i++) {
  if ((c.innerText || '').includes('Resume.pdf')) { best = c; break; }
  c = c.parentElement;
}
```

Either way assert the chip reads `… 185 KB Attached` before sending. Also note
`button[aria-label^="Remove attachment"]` matched **nothing** on this run even
with a live chip attached, so do not read `removeCount === 0` as "no
attachment" — the `figure` chip is the reliable read.

**A compose-length read taken right after a successful send can be non-zero (verified 2026-10-05).** The third
send signal is "compose `textContent` length is 0", but reading it ~2.5 s after
the click returned `3` on a send that had in fact delivered, and `Send` was
still enabled. Re-reading it seconds later gave `""` with `innerHTML` reduced to
`<p><br></p>` — an empty contenteditable placeholder. Judge the send on the
**thread marker plus the attachment bubble**, which is what actually proves
delivery, and treat a single early compose read as unconfirmed rather than as
failure. Do not "fix" it by sending a second copy.

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

## The "Yes, interested…" InMail quick reply is a TWO-STEP commit (verified 2026-10-02)

**Naive approach fails — and this is the dangerous one:** the quick-reply button sits at the
bottom of an inbound InMail thread with an accessible name that reads like it *is* the
reply, so the obvious move is to click it and call it sent:

```
button "Reply to conversation with “Yes, interested...”"
```

A plain Playwright `click()` on that locator **succeeds with no error and sends nothing.**
It opens an editable custom-reply composer instead. Nothing has left the machine at that
point, but every surface still looks like the reply was sent — which is the failure mode
the "verify a send" rule above exists to catch.

**What the click actually produces** (all three appear together):

```
generic: Yes, interested...
button "Cancel your custom reply and show the regular conversation message composer"
generic: Edit reply…
textbox "Edit reply…"          ← a TEXTAREA, pre-filled with LinkedIn's canned body
button "Accept this inmail from the recruiter and reply with the custom message."
  - generic: Send
```

**Working path — two clicks, verified between them:**

1. `getByRole('button', { name: /^Reply to conversation with .Yes, interested/ })` —
   check `count() === 1` first (the `“ ”` are curly quotes; a regex avoids escaping them).
2. Click it, wait ~2.5s, then snapshot and assert `Edit reply` is now present. **If
   `Edit reply` is absent the click did land as a send**; if present, you are in step 3.
3. Read the draft before sending. It is a plain `TEXTAREA`, so `textContent` and
   `innerText` both return `""` — read `el.value` through `locator.evaluate` instead. The
   canned body for this reply is *"Hi <Name>, thank you for reaching out. I would like to
   learn more about this opportunity."* Edit it if the candidate wants different words.
4. `getByRole('button', { name: /Accept this inmail from the recruiter and reply with the custom message/ })`
   — `count() === 1`. The accessible name says nothing about sending; the nested
   `generic: Send` is the visible label. Click it.
5. **Verify all of:** the thread shows `generic: Candidate Name sent the following
   message(s) at <time>` with the body as a `paragraph`, a
   `generic "Sent at <date>, <time>"` tooltip on that bubble, and *both* `Edit reply`
   and the `Yes/No thanks` quick replies gone from the DOM.

The `Cancel your custom reply…` button is the escape hatch if the draft is wrong before
step 4 — cancelling is safe and sends nothing.

---

# Connection invites — the dialog that lies about its target, and how to type into it

Verified 2026-10-03 across four referral invites.

## The dialog can still be showing the PREVIOUS person

**This is the one that can cause a real mistake.** Navigating directly to
`/preload/custom-invite/?vanityName=<new-handle>` does not always reset the
dialog. It rendered, for a *different* target:

> Add a note to your invitation?
> Personalize your invitation to **Pulkit Singhal** by adding a note.

...when the URL said `vanityName=joylal4896`. Sending would have put a second
invite to Pulkit and skipped Joy entirely.

**Read the dialog's own text before typing.** The dialog renders the target's
name in plain text, so one evaluate settles it:

```js
const t = (document.querySelector('div[role=dialog]')?.innerText) || '';
const who = (t.match(/invitation to ([A-Za-z ]+?) by/) || [])[1];
```

If `who` is not the person you mean, back out and reach the dialog from that
person's **profile** (`a[href="/preload/custom-invite/?vanityName=..."]`) rather
than by navigating to the URL. Same fix that worked: the dialog state resets
when it is opened from a profile page rather than a bare URL.

## `cua.type` silently no-ops here; `fill()` works

The note textarea is a **zero-size hidden proxy** — `getBoundingClientRect()`
returns `0,0`, and `element.focus()` does not stick, so `cua.type` goes
nowhere with no error. Two of four invites were lost this way before the cause
was clear.

The locator's `fill({ force: true })` lands the text correctly:

```js
const ta = tab.playwright.locator('div[role=dialog] textarea');
await ta.fill(note, { force: true });
// verify: ta.evaluate(el => el.value.length) and the n/300 counter
```

Always read the length back. An empty textarea looks identical to a working one.

## The "Add a note" click needs a second attempt

The dialog opens on the `Add a note?` prompt. The first `cua.click` on that
button is often swallowed while the dialog animates in; the second lands. The
tell is `document.querySelector('textarea')` — check it immediately after each
click rather than assuming.

## The invite note is capped at 300 chars even on Premium

The dialog says *"You have unlimited notes with Premium"*, which reads like the
length is unlimited too. It is not — the note editor still shows
`Please limit personal note to 300 characters` with a live `n/300` counter, and
enforces it. Unlimited refers to note *count*. Read the live counter; do not
size to the plan.

## Verifying a send

Dialog gone is not proof. Read the profile toolbar afterwards and look for
`Pending`:

```js
const t = document.body.innerText.replace(/\s+/g,' ');
const i = t.indexOf('Joy Lal Chattaraj Senior');
t.slice(i, i + 130);   // -> "... Senior Software Engineer at Databricks Pending Message"
```

## People-search URLs are not stable evidence

Two traps when harvesting profile handles from a people search:

- **Do not infer a handle.** `deeksha-sood-4b306813` and
  `pulkit-singhal-74a3b4519` were guessed suffixes and were both wrong; the
  real ones were `deeksha-sood-a9b50426` and plain `pulkit-singhal`. Read the
  href off the result card.
- **A reload can change the result set entirely.** The same URL returned one set
  of people, then after `reload()` returned a different slice (2 cards instead
  of 10). Re-read and re-capture handles immediately before using them; don't
  reuse handles captured earlier in the session.

## Presence text is not a message

A conversation-list row showing `Status is reachable` / `Status is online`
next to a name is the **presence indicator**, not new mail. It renders right
under the contact name and can read like a truncated reply
(`Status is re...`). Check the row's actual message preview — a preview
beginning `You:` means nothing is owed.

## Sent invitations — the only honest way to check invite acceptance (verified 2026-10-04)

**Goal:** find out which of the invites you sent were actually accepted, so you know which
people can be DM'd and which are dead ends.

**Naive approach fails:** there is no per-invite "accepted / declined / expired" state anywhere in
the UI. `li` + `a[aria-label^="Withdraw invitation"]` returns `[]` — the rows are not `li` elements.
`document.querySelectorAll('main li')` returns only 3 nav fragments. Reading the sent list does
**not** tell you an invite was accepted; every row looks identical and every row still offers
"Withdraw", accepted or not.

**Working path:**

- Navigate by clicking, not by guessing: `My Network` → `Show all invitations`
  (`/mynetwork/invitation-manager/received/`) → the `Sent` link
  (`/mynetwork/invitation-manager/sent/`). The `People (N)` count on that page is the size of the
  pending pile and is the number to quote.
- Extract rows by walking paragraphs, not by element type. DOM order within a row is
  **name → headline → `Sent N (hours|days|weeks|months) ago`**, so from the age paragraph walk
  back two `p` elements: `ps[i-2]` is the person's name, `ps[i-1]` is the headline.
- The list paginates. Scroll repeatedly (`dom_cua.scroll`) and union the rows until the count you
  collected equals the `People (N)` header — that is the completeness check, not "it looks done".

**The mechanic that matters: acceptance is only observable by ABSENCE.** A pending invite stays in
this list forever, even long past LinkedIn's expiry. An accepted invite **leaves** it and becomes
a connection (and opens a message thread). So the question "did X accept?" cannot be answered
from the sent list at all — the only cheap proxy is: *does a message thread with X exist in
`/messaging/`?* Threads are therefore the real acceptance ledger, which is why
[Inbox triage](#inbox-triage--the-unread-chip-sticks-and-it-hides-todays-threads-verified-2026-10-01)
is the check that matters, not this page.

**Consequence for outreach planning:** a "follow-up due" on a *connection note* is usually
unactionable. LinkedIn will not DM a non-connection without spending an InMail credit, and
re-inviting someone who already ignored one invite burns weekly quota and reads as spray. Always
split a follow-up queue into `has a thread → DM is allowed` vs `no thread → the invite is the
only lever left, and often shouldn't be pulled`.

**Read the list for targeting quality, not just acceptance.** The Sent page is the cheapest audit
of whether a people-search was well-aimed: off-target profiles (recruiters, EA/HR/admin roles,
ML-titled roles when ML is excluded, DevOps/SRE titles) sitting in the pending pile mean the
search criteria are loose and the invite spend is being wasted. Old rows (`Sent 2 months ago`) are
effectively dead and can be withdrawn to free the weekly allowance.

## The InMail-accept Send button ignores a Playwright click (verified 2026-10-04)

**Goal:** send a custom reply on an inbound InMail (not the canned quick-reply body).

**Naive approach fails:** after the two-step composer is open (see the quick-reply entry
above), the `Accept this inmail from the recruiter and reply with the custom message.`
button reports `count() === 1` and `isEnabled() === true`, and a plain Playwright
`click()` **completes without error and sends nothing**. Every verification signal stays
negative: `Edit reply` still present, quick replies still present, no
`Candidate Name sent the following message` marker. This is the same class of failure as
the quick-reply click, one level deeper — and the button's own accessible name says
"Accept", so it is easy to believe it went.

**Working path:** hover-travel then coordinate click, same as the invite dialog:

```js
const r = await tab.playwright.evaluate(() => {
  const b = Array.from(document.querySelectorAll('button'))
    .find(x => /Accept this inmail/.test(x.getAttribute('aria-label') || ''));
  const box = b.getBoundingClientRect();
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
});
await tab.cua.move({ x: r.x - 220, y: r.y - 150 }); await tab.playwright.waitForTimeout(280);
await tab.cua.move({ x: r.x - 100, y: r.y - 70  }); await tab.playwright.waitForTimeout(280);
await tab.cua.move({ x: r.x - 30,  y: r.y - 20  }); await tab.playwright.waitForTimeout(280);
await tab.cua.move({ x: r.x,      y: r.y       }); await tab.playwright.waitForTimeout(550);
await tab.cua.click({ x: r.x, y: r.y });
```

That worked on the first try (1/1). **Read the geometry with `evaluate`, not from a
screenshot** — the button sits at roughly y≈652 in a 1280×720 pane, close enough to the
bottom edge that a screenshot-derived coordinate is easy to get wrong.

**Loading the custom body.** The `textbox "Edit reply…"` is a plain `TEXTAREA`, so
`textContent`/`innerText` both return `""`. Click it, `el.select()`, then
`document.execCommand("insertText", false, text)` via `locator.evaluate`, then **read
`el.value` back** as the verification. The draft survives a failed send, so a retry after
a dead click costs nothing — confirmed on this send, where the first click was a no-op and
the retry went out unchanged.

**Bonus: the InMail-accept path converts the thread.** After a successful accept-send the
detail pane's composer becomes an ordinary `textbox "Write a message…"`, the `Yes/No thanks`
quick replies disappear, and replies in that thread no longer consume an InMail credit. If
you want a TA thread to be a free conversation afterwards, this is the path.

## Inbound InMail threads hide outside the Focused list (verified 2026-10-04)

The Focused list on `/messaging/` is not a superset of live threads. An InMail that
arrived several days earlier and was never replied to may be **absent from Focused
entirely** — scrolling and "Load more conversations" will not surface it. Switch to the
`InMail` filter chip first (the `mousedown`/`mouseup`/`click` triple on the button whose
`innerText` is exactly `InMail`) before concluding a thread does not exist.

The InMail filter is also where **untriaged inbound pitches accumulate**, which the Focused
list hides entirely: on this run it surfaced four threads absent from Focused, including a
recruiter pitch for a Staff Data Engineer role and a second agentic-AI InMail. Triage the
InMail filter on every inbox pass, not just Focused.

## Reading people-search cards: parse the DOM from `/in/` anchors, not the ARIA snapshot (verified 2026-10-04)

**Goal:** pull a `keywords` + `network=["S"]` people search into structured rows
(name, handle, degree, headline, location) so they can be deduped against
`outreach list`.

**Naive approach fails:** slicing `domSnapshot()` on `- link "` and regexing the
accessible name is **unreliable here** — the name is nested one level down inside
a `- text:` node, and the aria label concatenates the name with the degree,
headline, location *and* the mutual-connection names. Parsing it returns single
letters (`"R"`, `"S"`), `"is a mutual connection"`, or `"\",\""` as the name on
most rows. `document.querySelectorAll('[data-view-name]')` — the usual
LinkedIn-card hook — returns an **empty list** on this page, so the usual
`[data-view-name="people-search-result"]` card selector finds nothing.

**Working path:** walk up from each `a[href*="/in/"]` and stop at the ancestor
whose text already contains the company, then read that container's lines:

```js
const seen = new Set(); const people = [];
for (const a of document.querySelectorAll('a[href*="/in/"]')) {
  const m = (a.getAttribute('href') || '').match(/\/in\/([^/?]+)/);
  if (!m || seen.has(m[1])) continue;
  let card = a;
  for (let i = 0; i < 8 && card.parentElement; i++) {
    card = card.parentElement;
    const t = card.innerText || '';
    if (t.includes('JPMorgan') || t.includes('JpMorgan') || t.includes('Chase')) break;
  }
  const lines = (card.innerText || '').split('\n').map(s => s.trim()).filter(Boolean);
  if (!lines.length) continue;
  seen.add(m[1]);
  people.push({ handle: m[1], name: lines[0], rest: lines.slice(1, 5) });
}
```

Two things to expect in the output. **Mutual-connection links inherit the
previous card's text** — the anchor for a shared connection sits inside the
neighbouring card, so it comes back with the *other* person's name and headline.
Read `rest[0]` (`"• 2nd"`) and drop any row whose name repeats the previous one.
And the card's trailing element is the action button, so `Connect` vs `Follow`
is simply the last line of `rest` — useful, but see below before filtering on it.

**A `Follow` button is still Connectable — 2nd confirmation (2026-10-04).** A
card whose only affordance read `Follow` (an SDE III at the target company, 2nd
degree, no Connect offered) accepted a connection invite through
`preload/custom-invite/?vanityName=<handle>` exactly like the others in the same
wave. Combined with the 2026-10-01 finding this now holds 2/2 — never pre-filter
a people-search candidate on the card's button.

**Inviting from a search result still needs the dialog-target check.** The recipe
above warns that `/preload/custom-invite/` can render the *previous* person; that
did not misfire here, but the check is one evaluate and caught every row before
typing: read `(dialog.innerText.match(/invitation to ([A-Za-z]+ [A-Za-z]+?) by/)||[])[1]`
and abort unless it matches the intended name. Note that this regex returns
`null` once the note view opens (the phrasing changes), so take it on the
`Add a note?` prompt, before dispatching the "Add a note" click.

**A character-count guard is worth the ceremony.** One send was blocked mid-wave
by a verify call that referenced an undefined variable; the guard compared the
typed `textarea.value` against the intended string and refused to dispatch Send.
That is the right failure — a truncated or doubled type is caught before the
invite is spent, and the draft survives for a clean retry.

## The Singapore-blamed Coupang req was a retitle, not a location mismatch (2026-10-05)

**Goal:** liveness-check the Coupang "Staff Backend Engineer, Commerce" req
(LinkedIn id 4472503794) that an earlier session boarded as `app-m2il`.

**The earlier call was wrong, and the correction matters.** The sweep entry above
says that req "appears on `coupang.jobs` only as **Singapore**" and advises
treating the Bengaluru listing as unverified. Both halves are false. The req is
live and it **is** Bengaluru — Coupang **retitled** it. The board record is
`7916740` **"Staff Backend Engineer - Intelligent Cloud"**, Bengaluru, which is
the same posting under a new name and a new LinkedIn id. Do not retire a req on
a location mismatch alone: diff the JD text before concluding anything.

**How to prove two postings are the same req (no guesswork).** Shared 8-gram
overlap on the unescaped JD text settles it. Normalize to lowercase, split on
whitespace, and count how many of source A's 8-word windows appear in B:

- Singapore `8194727` "Staff Backend Engineer" vs the Commerce JD → **154/726** (different req)
- Bengaluru `7916740` "Intelligent Cloud" vs the Commerce JD → **718/734** (same req)

Above ~90% it is a retitle or a mirror; below ~30% they are different jobs. This
is the same test that catches the Extreme Networks and Amazon duplicate clusters
in the sweep entry above, but it works on JD *bodies* rather than titles — which
matters because a retitle breaks every title-based dedupe.

## Three mechanics settled on 2026-10-05 (two sends, both verified)

**1. The send click is eaten on plain text too — go straight to evaluate-dispatch.**
Two sends in one session, both with the documented hover-travel + dwell click:
the text+attachment one and a **text-only message with no attachment at all**.
Both times the click landed, no error surfaced, and the draft sat in the compose
box with the marker count unchanged. So the 2026-10-04 note ("a reply carrying an
attachment, so it is not a fresh-render-only bug") can be tightened: the eaten
click is neither fresh-render-only **nor** attachment-specific. Run the
hover-travel, read the three signals, and if the draft is still there dispatch
the form's own `click()` — but do not spend two attempts hoping. Both sends on
this run delivered on the first evaluate-dispatch, 2/2.

**2. Guard on the thread `h2` before typing — the open tab drifts.**
Between reading a thread and typing into it, the tab was moved to a *different*
thread (`?filter=inmail` still on the URL), and an out-of-band view of the tab
reported a third URL that was simply wrong. The cheap guard, run before every
`execCommand` insert, is the recipe's existing "read the dialog's own text"
move applied to threads:

```js
const who = await tab.playwright.evaluate(() => {
  for (const el of document.querySelectorAll('h2'))
    if (/^Mustufa Khan$/.test((el.innerText || '').trim())) return 'Mustufa Khan';
  return null;
});
if (who !== 'Mustufa Khan') throw new Error('wrong thread open, heading=' + who);
```

This caught a real misfire before anything was typed. Cost: one evaluate.
Never trust a remembered tab state, and never trust ambient/UI state that
describes the tab — re-derive the thread identity from the page.

**3. Message attachments cannot be saved programmatically — ask the candidate.**
Anu Krishnan sent `JD_Staff AI Engineer.docx` (20 KB) as a thread attachment.
Both documented download routes fail, in different ways:

- `locator.downloadMedia()` on the `button "DOC JD_Staff AI Engineer.docx 20 KB Download"`
  → `Error: Matched element does not expose a downloadable URL`. The button is
  not backed by an href.
- `waitForEvent("download")` + `click()` → the event **does fire**, and the
  returned `PlaywrightDownload` is a **stub**: `Object.keys()` is `[]`,
  `suggestedFilename` is `null`, and `dl.saveAs` is not a function. Nothing
  reaches disk — `~/Downloads` was unchanged afterwards.

So a JD that only exists as a LinkedIn message attachment has to be downloaded
by the candidate by hand, then the agent picks it up off the filesystem. Say so
plainly and ask; do not burn calls re-deriving URLs. (Once the candidate has
dropped the file, `unzip -p <docx> word/document.xml` plus a tag strip recovers
the text cleanly, and the `.md` is what `job add --file` and
`job evidence --kind jd-snapshot` both accept — `.docx` itself is rejected as an
evidence type.)


**`coupang.jobs` is Greenhouse, and the board API answers the liveness question
for free (2026-10-05).** The site 403s every plain request (`/api/jobs`,
`/en/api/jobs`, `/jobs.json` all 403; `/api/v1/jobs` 301s), so the browser looks
like the only way in. It is not: the listing rows carry `gh_jid=<id>`, and the
board token is the company name, so

```
https://boards-api.greenhouse.io/v1/boards/coupang/jobs?content=true
```

returns all 688 open reqs with full JD bodies in one unauthenticated call
(12.6 MB). Liveness is then a substring match of the req id in that payload —
`?gh_jid=7916740` appears for the Bengaluru req, and no id matches the retired
LinkedIn `gh_jid=4472503794`, which is why the id check alone reads as
"delisted". See [greenhouse.md](greenhouse.md) for the unescape trap; the
double-escape in this board's content is worse than the documented case and
costs 20–55 match points if you decode once instead of to a fixed point.


**The guest posting API is dead; email digest subjects are lies; the id is
truth (2026-10-06).** Three findings from an email-sweep registration pass:

1. `linkedin.com/jobs/guest/jobs/api/jobPosting/{id}` returns an auth wall to
   curl **and** a "This page doesn't exist" shell in the browser. Do not retry
   it. The public `linkedin.com/jobs/view/{id}` still renders logged-in.
2. On a *fresh* tab the job page renders only the top card; the description
   XHR hangs (a `progressbar "In progress"` sits where "About the job" should
   be) and `body.innerText` tops out around 1.5 KB. The description **does**
   hydrate on a tab that has been open a while — reuse one "warm" tab for all
   navigations, wait ~4 s, then extract
   `Array.from(new Set([body.innerText, ...document.querySelectorAll("[class*='description'], .show-more-less-html__markup")].map(e => e.innerText))).join("\n")`
   (the Set-join matters: description containers repeat the body text).
3. A LinkedIn job-alert digest puts its subject on every link it carries, and
   the links routinely belong to *other* jobs (a "Synopsys" alert linked an
   EnCharge AI req; a "Visa" alert linked GitLab and Nanonets). Never trust the
   digest subject — navigate the id and read the real `<title>`.

Bonus: the top card's **Apply** anchor carries the canonical ATS URL (Workday
`REF...` path, Greenhouse job id, SmartRecruiters posting) even when the
description never loads. Harvest `a[href*="safety/go"]`, decode the
`url=` parameter, and fetch the JD from the ATS API (cxs / boards-api /
smartrecruiters API) instead of fighting the LinkedIn page at all.

## The InMail-accept send confirms LATE — do not double-send during the lag (verified 2026-10-07)

**Goal:** reply on an inbound InMail via the custom-reply composer and *know* it went.

**What happened:** on one accept-send, the hover-travel click was eaten (known), and the
evaluate-dispatch fallback — the documented working path — appeared to do nothing: after a
3 s wait the thread showed no `Candidate Name sent the following message` marker, the
accept button was still in the DOM, and the quick replies were still present. Two more
send attempts were prepared on the strength of that read (a retype via `cua.type`). The
message then surfaced in the thread **sent exactly once, from the first evaluate-dispatch**
— the confirmation simply lagged well past 3 s (the marker, the button removal and the
quick-reply removal all landed together, late).

**The rule:** after dispatching the accept button, treat "nothing changed at 3 s" as
**unconfirmed**, not failed. Re-poll the thread-marker/quick-reply state for ~10 s before
attempting any second send — a duplicate InMail reply cannot be unsent. Judge delivery on
the marker + body text + quick-replies-gone trio, exactly as the compose-length warning
above says, just with a longer window.

**Two more mechanics from the same thread:**

- The `Edit reply…` textarea can **lose its aria-label** after programmatic
  focus/select/insertText — `getByRole('textbox', { name: 'Edit reply…' })` then finds
  nothing and looks like the composer vanished. Locate it by content instead
  (`textarea` whose `.value` contains a draft substring) and re-read `.value` before any
  send attempt.
- A coordinate click aimed at that textarea during the confirmation lag can dismiss the
  custom-reply composer outright (click landed, activeElement fell back to BODY, draft
  textarea gone). Re-observe before every step; if the composer state doesn't match what
  the recipe says it should be, stop and read the thread state before touching anything.
