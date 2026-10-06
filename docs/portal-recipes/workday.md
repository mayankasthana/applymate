# Workday recruiting tenants (myworkdaysite.com) — apply flow

Covers the candidate-facing Workday recruiting portal (e.g. `wd1.myworkdaysite.com/recruiting/wf/<Tenant>`).
Verified 2026-10-01 on the Wells Fargo tenant (`wd1.myworkdaysite.com/recruiting/wf/WellsFargoJobs`),
Chrome in-app browser (Playwright + dom_cua + cua surfaces).

## Reaching the apply flow

- Goal: open the application for a requisition.
- Naive approach fails: clicking the `Apply` button on the job page via Playwright
  `getByRole('button', {name:'Apply'})` — times out even though the ARIA snapshot shows it.
  Workday renders controls as `<a role="button" href="...">` inside web components; the role
  engine stalls on them.
- Working path: read `href`s straight out of `dom_cua.get_visible_dom()` and navigate to them:
  - start options: `<job-url>/apply` → "Autofill with Resume" / "Apply Manually" / "Use My Last Application"
  - `.../apply/autofillWithResume`, `.../apply/applyManually`, `.../apply/useMyLastApplication` (all plain URLs)
  - flow stepper: Create Account/Sign In → Autofill with Resume → My Information → My Experience →
    Application Questions → Voluntary Disclosures → Review.
- Verified: 2026-10-01, once (Wells Fargo).

## Filling forms (controlled inputs in shadow DOM)

- Naive approach fails: `dom_cua.type` after `dom_cua.click` — text sometimes never lands on a
  fresh page (focus race); and the framework rejects the value at submit with "enter a valid email"
  even when the text is visibly in the field, because validation reads the framework state, which
  updates on blur/change, not on programmatic set alone.
- Working path (reliable order):
  1. `tab.playwright.locator('input[type="..."]')` — Playwright CSS pierces the open shadow roots;
     disambiguate with `.filter({ visible: true })` and `.first()/nth()` after checking `count()`.
     `fill()` sets the value correctly.
  2. Blur the field (click a heading) so change/blur handlers run.
  3. Click the submit button by **coordinate** (`tab.cua.click`). Playwright `.click()` on these
     buttons times out even when `count() === 1` — don't burn retries on it. `dom_cua.click({node_id})`
     also works for clicks, with fresh refs from a fresh `get_visible_dom()` each time.
  4. Page scroll shifts between steps — re-screenshot before every coordinate click; don't reuse
     coordinates from an older screenshot.
- Honeypot: every form carries `input[name="website"]` (1px wide, labelled "This input is for robots
  only, do not enter i…"). Leave it empty.
- Checkboxes: clicking the `<label>` does not toggle Workday checkboxes; click the box square by
  coordinate.
- Verified: 2026-10-01, several times.

## Account creation trap (silent half-failure)

- Naive approach fails: filling Create Account (email + password + verify + consent checkbox +
  Create Account) redirects to `/login?redirect=...` looking like success, but the first sign-in then
  fails with "You may have entered the wrong email address or password or your account might be
  locked." The account exists; the password doesn't match what was typed.
- Working path: use **Forgot your password?** (it's a `<button>`, not a link) → submit the email
  (fill + blur + coordinate click) → the reset mail arrives within minutes → open the
  `…/passwordreset/<token>/?redirect=<back into the apply flow>&username=…` link from the mail →
  set the new password (fill + blur + coordinate click Submit) → the same tab lands on Sign In →
  sign in → the flow resumes exactly where it left off.
- Verified: 2026-10-01, once (needed exactly once — treat as the standard recovery).

## Duplicate-application detection (check before staging anything)

- After sign-in, `<job-url>/apply/autofillWithResume` (and the manual path) short-circuits with
  **"You've already applied for this job"** if any application exists under that email — Workday
  dedupes by email, and an application made months earlier under the same address (even pre-account,
  applied directly) is matched to the newly created account.
- Working path: go to Candidate Home (`/userHome`) → **My Applications** (scroll down) → Active /
  Inactive tabs show every application with req number, status (Review etc.) and the original
  submission date. Screenshot that table as evidence before touching the board.
- Verified: 2026-10-01, once.

## Document swap (delete + re-upload) inside an apply flow

- Goal: replace an uploaded resume/cover letter with a copy under a different filename, without refilling anything.
- Naive approach fails: the file `Delete` buttons are all named just "Delete" (indistinguishable from
  the work-experience/education Delete buttons) in `dom_cua.get_visible_dom()`, and the upload widget's
  file chips live in shadow DOM that dump does not traverse. Clicking Deletes by position risks deleting
  a work-experience entry.
- Working path:
  1. Delete: `getByRole("button", { name: "Delete <exact filename>.pdf" })` — the ARIA tree (domSnapshot)
     carries the full unique names even though the node dump does not. `locator.evaluate(el => el.click())`
     dispatches the DOM click Playwright's actionability check stalls on. One delete per observation cycle;
     verify the chip is gone before the next.
  2. Upload: read the file in Node, pass base64 into `playwright.evaluate(fn, arg)`; inside the page build
     `new File([bytes], name, {type:"application/pdf"})` → `DataTransfer` → assign `input.files = dt.files`
     on the last `input[type="file"]` → dispatch `new Event("change", {bubbles:true})`. The widget fires its
     usual "successfully uploaded" alert and renders the chip.
- Verified: 2026-10-01, twice (Thomson Reuters tenant, both files).

## Typeahead "Select One" fields: fill() may be the select, not the search

- Naive approach fails: on a typeahead `textbox` (e.g. Country Phone Code), `fill("91")` then reading
  `el.value` shows "" — looks like the fill bounced, tempting a trusted-keystroke retry that then
  times out on clickability because the suggestion listbox covers the input.
- What is actually happening: `fill()` typed the search term, the widget auto-matched and selected it as
  a chip. The selection is visible in the domSnapshot as `generic: 1 item selected, India (+91)` plus an
  `option "India (+91), press delete to clear value."` inside `listbox "items selected"`. The textbox stays
  empty because it is only the search box.
- Working path: `fill()` the term, wait, then verify via the snapshot's "N item(s) selected" text — do not
  verify via the textbox value. To clear a typed-but-unmatched search term, `fill("")` works even where
  Meta/Ctrl+A keypresses do not.
- Verified: 2026-10-01, once (Thomson Reuters).

## Advancing the stepper when Playwright and node clicks both miss

- `get_visible_dom()` sometimes omits the page `Save and Continue` button entirely (mid-hydration), and
  a `dom_cua` click on a stale ref throws "not found". A `locator.evaluate(el => el.click())` dispatch from
  the ARIA snapshot's role+name usually works; if the page appears unchanged right after, take a fresh
  snapshot before re-clicking — the SPA often completes the step transition after the snapshot was taken
  (the snapshot races the re-render; check `Application Progress` markers, not just the heading).
- Verified: 2026-10-01, twice (Thomson Reuters; both clicks had landed, one snapshot simply came early).

## General discipline on this tenant

- One state change per observation, screenshot after every click (buttons move with scroll).
- `waitForTimeout` 2–4 s after navigation; the SPA hydrates late (snapshots taken too early show an
  empty main region).
- Email round-trips (reset links) are readable read-only via the candidate's mailbox if the
  candidate has approved that channel; never guess token URLs.

## Text inputs commit only with trusted keystrokes (verified 2026-10-01, JioStar tenant)

- Goal: get a value into a Workday text input so it survives validation and submit.
- Naive approach fails: `locator.fill(value)` then blur, then submit. The text is visibly in the
  field and the inline error clears, but submit re-raises "The field X is required and must have
  a value" — validation reads framework state, not the DOM value. Worse, dispatching synthetic
  `input`/`change`/`focusout` events from `evaluate()` clears the error while permanently
  desyncing React's value tracker, leaving the Save button disabled with no visible error and no
  way to recover without a page reload.
- Working path (trusted input, no synthetic events):
  1. `cua.click({x, y})` at the field's centre — a real user-level click, so the framework registers focus.
  2. `locator.evaluate(el => el.select())` — **required**; `ControlOrMeta+A` and `CTRL+A` do not
     select in these inputs, so typing appends and yields `65000006500000`.
  3. `cua.type({text})` with a delay. Per-character `locator.press("6")` does not register at all;
     `type()` does.
  4. `cua.keypress({keys:["TAB"]})` to blur onto another control.
- `cua.keypress` takes `keys` as an **array**, e.g. `{keys:["CTRL","A"]}` — a bare string is rejected.
- `fill()` on some widgets (Workday date-of-birth segments) throws a clipboard error
  ("Active element is no longer the expected input target").
- Checkboxes: a coordinate click on the 24x24 square does **not** toggle. `check({force: true})` does.

## Drafts restart at step 1 — never reload mid-flow (verified 2026-10-01, JioStar tenant)

- Goal: complete a multi-step application.
- Naive approach fails: reloading the page, or leaving via "Continue Application", discards every
  edit from step 2 onward and re-enters the flow at step 1. On the JioStar tenant this silently
  discarded a re-uploaded resume, four rewritten role descriptions, and an already-saved
  compensation figure.
- Working path: finish the whole flow in one continuous session. Verify progress by reading the
  stepper ("current step N of M") after every Save rather than assuming the click landed.
- Editing work-experience role descriptions does not survive a reload — the block re-hydrates from
  the candidate profile, which only updates on final submit. There is no per-entry Save; the only
  control is the page-level Save and Continue.
- Verified: 2026-10-01, once (JioStar, JR10079).

## Reading the JD as JSON, without a browser (verified 2026-10-02)

Most `myworkdayjobs.com` / `myworkdaysite.com` postings serve the full JD as
JSON from a `wday/cxs` endpoint. Use this to read a JD in bulk — it removed the
need for a browser on 20 of 21 postings in one batch, and the browser hung or
returned an empty `document.body` on every one of them.

- **Naive approach fails (two ways, both silent):**
  1. Building the cxs URL from the tenant *page* segment. `solera…/Global_Career_Site/job/…`
     is tenant **`solera`**, site `Global_Career_Site` — not `Global`, not `Global_Career_Site`.
     Taking `site.split("_")[0]` yields `Global` and the request 406s.
  2. Dropping the `/job/` segment. The posting URL is `…/<site>/job/<path>` but
     cxs is `…/wday/cxs/<tenant>/<site>/job/<path>` — the `/job/` stays.
- **Working path:**
  ```
  https://<host>/wday/cxs/<tenant>/<site>/job/<path>
  ```
  `Accept: application/json`, returns `{"jobPostingInfo": {"title", "jobDescription", "jobLocationInfo"}}`.
- **Getting the tenant, which differs by URL shape:**
  - careers board `<host>/en-US/<Site>/job/<path>` → tenant is the **hostname's first label**
    (`solera.wd5.…` → `solera`; `ffive.wd5.…` → **`ffive`**, not `f5`)
  - recruiting app `<host>/en-US/recruiting/<Tenant>/<Site>/job/<path>` → tenant is the
    **`recruiting/` path segment** (`microchiphr`, not `microchip`)
  - Wrong tenant → `HTTP_422`. A WAF → `HTTP_406`. A 406 is **not** proof of bot
    protection: check the tenant before concluding the tenant blocks you.
- **A blank `document.body.innerText` in the browser does not mean the posting is dead.**
  The careers app hydrates late and the recruiting app sometimes never renders;
  it said "dead" on Microchip while cxs returned a full JD. Go to cxs first.
- Verified: 2026-10-02, 20 postings across the Magnitude, F5, Genesys, Epicor,
  Solera, Arctic Wolf, Microchip, CBA, Zebra and TransUnion tenants.

## Public careers tenant `*.myworkdayjobs.com` is a different product (verified 2026-10-02, Maersk)

- The entries above all cover `myworkdaysite.com/recruiting/wf/<Tenant>` (the apply/recruiting
  app). A public careers board is a **different Workday product** with a different URL shape:
  `<subdomain>.wd<N>.myworkdayjobs.com/<Tenant>_Careers/job/<Location>/<Slug>_<REQID>`.
- **CORRECTION (2026-10-03, Eli Lilly):** the earlier note here said not to feed a
  `myworkdayjobs.com` posting URL into the `.../apply/autofillWithResume` recipe because
  "the paths do not carry over". **They do carry over** on this product — the Maersk case
  failed for a different reason (its site segment is `Maersk_Careers`, not `Maersk`).
  On `lilly.wd115.myworkdayjobs.com` the full chain below worked first time:
  `…/en-US/LLY/job/<Location>/<Slug>_<REQID>` → `…/apply` → `…/apply/autofillWithResume`.
  The real variable is the **site segment**, which this tenant spells `LLY`.
- `<Tenant>_Careers` (careers site) and `<Tenant>` (apply app) are separate tenants. A
  posting URL must be read for which one it is before constructing any apply path.
- The posting page renders fully in the ARIA snapshot from `domSnapshot()` on first load —
  the whole JD (description, responsibilities, required skills, similar jobs) is present as
  `paragraph` / `listitem` nodes, so a JD can be captured without scrolling or expanding
  anything. Remote type, location, time type, posted date and req id appear as
  `term` / `definition` pairs right under the title.
- **Do NOT use `screenshot({fullPage: true})` for JD evidence on any of these portals.**
  Chrome's stitched full-page capture on a tall SPA re-renders the *entire document* once per
  tile, so a 4,800px posting comes out as the same header + hero + JD repeated four times
  down one image. It is not a sticky-header artifact: the page has zero `position: fixed` or
  `sticky` elements (verified via `getComputedStyle` over `document` and shadow roots). Same
  failure seen on Twilio, UiPath, Adyen, Glean, Zeit.ai, Strac, TrueFoundry, Amgen, eBay,
  Databricks, Wells Fargo and Walmart — it is a property of the capture, not the site.
- Working path: set the viewport to `1280x1300`, `window.scrollTo(0, y)` in ~1,150px steps,
  and take one viewport-sized screenshot per step. 3–4 frames cover a typical posting, are
  continuous, and show the sticky header exactly once per frame — which is what a human
  scrolling sees. Store each frame separately with `job evidence` and delete the bad
  full-page file.
- Cookie/consent banners must be dismissed before capturing. The control names differ by
  tenant: Workday careers is `Decline`; UiPath is a `region "Cookie banner"` with a `Close`
  button (not `Accept and continue`); eBay careers opens a **recruitment chatbot** that
  covers the right column — close it via `getByRole("button", {name: "Close Chatbot Window"})`;
  Amgen opens a fraud-warning banner whose close button has an **empty accessible name**, so
  find it by iterating the unnamed buttons.
- Check the capture before storing it. A repeated full-page capture is easy to miss if you
  only look at the top; compare the image's height against the page's `scrollHeight` — a
  capture much taller than expected, or with the same block at top and bottom, is the
  artifact.
- `similar jobs` links on this tenant carry doubled/duplicated query strings
  (`?source=LinkedIn?source=LinkedIn?source=LinkedIn`) and a duplicated locale path. Read the
  req id from the link text and the `/job/` path segment, not the query string.
- Verified: 2026-10-02, once (Maersk, R198407, `maersk.wd3.myworkdayjobs.com`).

## Widgets that are not automatable in the in-app browser (verified 2026-10-01, JioStar tenant)

- **Date of birth segments** — all three `dateSection{Month,Day,Year}-input` elements measure 0x0 px
  and carry `tabindex="-1"`. Clicking the visible placeholder DIVs does nothing; the Calendar
  button opens a grid containing zero `[role="gridcell"]`. Hand off to the candidate.
- **Multiselect typeaheads** (Citizenship Status, Field of Study, Skills) — typing a term renders
  no `[role="option"]` at all and "0 items selected" persists. The react-virtualized grid does not
  lay out in this webview. Hand off to the candidate.
- Symptom of both: the field looks present in the ARIA snapshot but cannot be driven.
- Note the phone field re-displays with a leading 0 after reload on the India profile; that is the
  tenant's own mask, not corrupt data — do not "fix" it.

## Bulk job search on any tenant — the `jobs` POST endpoint (verified 2026-10-03, Eli Lilly `lilly.wd115`)

**Goal:** enumerate every posting for a country/keyword without paging a UI, and read
each JD without a browser. A 687-posting India sweep + 10 JD fetches ran in one
script with no browser at all.

**Naive approach fails:** the public careers board here is a **Phenom** front end
(`careers.lilly.com`) sitting in front of a separate Workday tenant
(`lilly.wd115.myworkdayjobs.com`), and the two do not agree. `careers.lilly.com`
sits behind a Cloudflare managed challenge (`curl` → `403`, `cf-mitigated:
challenge`), and its `?location=India` query param returns "No search results
found" even though Workday lists 198 India postings. **The Phenom board's filters
are not the source of truth — the Workday tenant is.**

**Working path — search:**

```
POST https://<host>/wday/cxs/<tenant>/<Site>/jobs
Content-Type: application/json   Accept: application/json
{"appliedFacets":{},"limit":20,"offset":0,"searchText":"India"}
```

Returns `{total, jobPostings:[{title, locationsText, externalPath}]}`. Page with
`offset += limit` until `jobPostings` is empty; `limit` above 20 works.
Then read a JD with the usual cxs shape — the `/job/` segment stays:

```
GET https://<host>/wday/cxs/<tenant>/<Site><externalPath>
```

- **The tenant is neither the hostname's first label nor the site segment here.**
  Host `lilly.wd115.myworkdayjobs.com`, site `LLY`: tenant `lilly` → **200**,
  tenant `LLY` → **422**, and `.../cxs/LLY` alone → **406**. The
  hostname-first-label rule from the entries above does hold here; the site segment
  (`LLY`) is not the tenant.
- Read a JD as text by stripping tags off `jobPostingInfo.jobDescription` — it is
  HTML with `<p style=...>` wrappers and `&#39;` / `&#43;` / `&#64;` entities.
  `jobLocationInfo` is `null` on this tenant; `locationsText` on the search
  result carries the location instead.
- Verified: 2026-10-03, `lilly.wd115.myworkdayjobs.com`, tenant `lilly`, site
  `LLY` — 687 India postings swept, 20 JDs fetched.

**Screenshots time out on the JOB POSTING page of this tenant** — `tab.screenshot()` fails
with `browser screenshot surface preparation timed out after 3000ms` (same failure mode as
the eBay Phenom note above). The posting page itself hydrates fine in-browser (~9–16 KB of
`document.body.innerText`, live `Apply` button, and an `End Date: … (N days left to apply)`
line), so **read liveness and the deadline from the rendered text and file
`job evidence … --kind jd-snapshot` with the text**, rather than burning time on a capture
that will not land.

- **CORRECTION (2026-10-03, Eli Lilly apply flow):** this is a **page-specific** failure,
  not a tenant-wide one. Screenshots worked normally on `/apply/autofillWithResume`, on the
  Review step, and on the post-submit confirmation page — three captures in one session,
  including the submit proof. Do not carry "screenshots are dead on Lilly" forward; scope
  the workaround to the JD posting page only.

---

## A full apply flow on a `myworkdayjobs.com` tenant (verified 2026-10-03, Eli Lilly `lilly.wd115`)

End-to-end run: R-112121, Bengaluru, account creation through submission. The
`.../apply` options page offers **Autofill with Resume / Apply Manually / Use My Last
Application**. `includeResumeParsing: true` on this req, so the resume upload autofills.

**Step 1 of 8 is Create Account/Sign In, and the stepper drops to 7 of 7 once it clears.**
That step disappearing is the proof the account took. No duplicate-application warning
appeared, so no prior application existed under that email. Accounts are per-tenant —
ones from other Workday employers (JioStar, Thomson Reuters, Maersk) do **not** carry over.

### Read the field before filling it — the labels are not where you expect

`data-automation-id` is useless on these inputs. Walk shadow roots and read `id`/`name`
instead; they carry a stable index and a readable suffix:

```
input#address--addressLine1        input#name--legalName--firstName
input#workExperience-65--companyName input#workExperience-65--roleDescription
input#education-1074--schoolName    button#education-1074--degree
input#phoneNumber--phoneNumber      input[name="candidateIsPreviousWorker"][value="false"]
```

Question dropdowns are `<button id="primaryQuestionnaire--<hash>">` on page 1 and
`secondaryQuestionnaire--<hash>` on page 2 — **the prefix changes between pages**, so a
selector written for one page silently matches nothing on the other. Prefer
`getByRole("button", { name: /Degree Select One/i })` over enumerating ids.

### `fill()` alone does not commit — and a never-focused field needs `click()` first

Confirms and extends the JioStar note above. `locator.type()` alone left four Company
fields unregistered (DOM value correct, save failed with "The field Company is required").
`click()` **before** typing fixed it. The sequence that reliably commits:

```js
await loc.click();          // required on a field that has never been focused
await loc.fill("");
await loc.type(value, { delay: 20 });
await loc.press("Tab");     // blur so change/blur handlers run
```

### Masked date spinbuttons: `.click()` times out, `focus()` works

`input[id$="-dateSectionYear-input"]` sits under an overlay
(`div[id$="-dateSectionYear-display"]`) that intercepts the click, so Playwright reports
"covered by …" and times out. Do not retry the locator — focus it directly:

```js
await loc.evaluate((el) => el.focus());
await loc.fill(""); await loc.type("2010", { delay: 25 }); await loc.press("Tab");
```

### Illegal characters rejected at save

Role Description rejects `< > [ ] " { } \` with *"Contains illegal characters"*. The
resume parser copies straight quotes straight through (e.g. a project name in double
quotes, a metric value in double quotes), so **swap `"` → `'` in every parsed description
before saving**, or the step will not advance. A scrub of `/[<>[\]{}"\\]/` across all
textareas catches it.

### A field can save clean and still be empty — verify on Review

The single most important habit here. A free-text answer read back correctly in the DOM,
`Save and Continue` returned with **no error block**, and the Review page rendered
**"No Response"**. It is only caught by re-reading Review. (Re-entering with
`click → fill("") → type → Tab` did commit it — but the first attempt used
`click → fill("") → type` with no `Tab` and silently failed.)

**So: after the last step, read the Review page and assert every required answer you set,
not the DOM.**

### The second row of a repeatable block vanishes unless the first is re-committed

Cost three attempts and one near-data-loss on Education entries. `Add Another` renders the
new row client-side; if the **first** row is not touched again afterwards, the save
serialises only one of them and the other disappears — sometimes taking its years with it.
Working order:

1. `Add Another` → fill the **second** row completely.
2. Go back and **re-type the first row's fields and re-select its degree**.
3. Only then Save.

Verified: 2 of 2 entries present on Review with both date ranges intact. Note this matters
most for integrated/dual programmes (one institution, two degrees) — check whether the
tenant holds repeat education rows at all before assuming one row is enough.

### Typeahead chips (`Field of Study`) never commit on this tenant

Typing a term and pressing Enter *does* select — the widget flips from `0 items selected`
to `Minimized`. But the chip never reaches the framework model:

- `Tab` to blur **discards** it, straight back to `0 items selected`;
- saving while it reads `Minimized` writes **"No Response"** to Review;
- the option list never enters the DOM, so there is no element to click to commit it.

Do not spend attempts here. The field is optional on Education (no asterisk); the degrees,
school and dates are what a screener reads. If it ever matters, a human must pick from the
dropdown by hand.

### Phone number wants local digits only

`Country / Region Phone Code` is a separate selected chip (e.g. `India (+91)`). The number
field rejects a value carrying its own country prefix — the parser's
`+91-9XXXXXXXXX` fails with *"Enter a valid format for Phone Number"* — it wants the
local subscriber digits only.

### Deleting a parser-invented row

Every `Delete` in a repeatable block is named exactly `Delete`, so `getByRole` is ambiguous.
Scope to the row: find the row's `jobTitle` input, climb ancestors until you hit one with
exactly one `Delete` button, and `evaluate(el => el.click())` it. Verify the row count
dropped before doing anything else. (Here the parser had invented an entry with a garbled
title, no company, no dates, and the entire resume summary as its description.)

### Post-submit proof

This tenant issues **no confirmation number**. The proof is Candidate Home → My Applications
→ the row (`Job Req` + `My Application Status: Application Received` + `Date Submitted`),
plus the "Application Submitted" modal. The modal covers the table — dismiss it and scroll
to the row to capture both. Assert `Active (1)` rather than trusting the modal.

## Referral `shared_id` apply flow on `wd504` (verified 2026-10-06, Walmart R-2648853)

End-to-end: signed-in user, resume parse ON, six steps after sign-in
(Autofill → My Information → My Experience → Application Questions → Voluntary
Disclosures → Review → Submit). Every finding below is from this one flow.

### The referral token survives the whole flow — no special path needed

- The Workday referral email links the posting with `?shared_id=<token>`. Opening that
  URL and clicking `Apply` → `Autofill with Resume` keeps the token in the URL through
  **every** step including the post-submit `jobTasks/completed/application` page. Nothing
  extra to do; do not strip the query string.
- Proof the referral actually tagged the application: the submission receipt's
  business-process line reads `Job Application: <name> (Referral) - R-<id> (<C-id>) on
  MM/DD/YYYY` — the `(Referral)` marker. Without it, the shared_id did not carry.
- This tenant DOES issue a confirmation number (the `C-…` in that line), unlike Eli
  Lilly. The Candidate Home row and the receipt both carry it.

### The flow can silently regress a completed step — finish each step in one call

- Naive approach fails: after a locator error on a later step, the SPA re-rendered back
  to **step 1** with the uploaded resume chip gone (once, mid-flow, ~40s after the step
  had been completed). No error is shown; the stepper is the only tell.
- Working path: verify the stepper still shows your step after **every** call; if it
  regressed, redo the lost step (upload + Continue) **in the same JS call** that
  verifies the chip. Linger as little as possible between steps.

### Select-one dropdowns: dispatch both the button AND the option

- On this tenant `locator.click()` on dropdown buttons and `option` elements times out
  on actionability (shadow DOM), even when `count() === 1`. The recipe-level
  `evaluate(el => el.click())` pattern applies to **both** sides:
  - open: find the button by `aria-label` text match, dispatch click;
  - pick: `document.querySelectorAll('[role="option"]')` → match `textContent.trim()`
    exactly → dispatch click;
  - verify: re-read the button's `aria-label` — it flips to `<selected value> Required`.
- Options for a Yes/No question are exactly `["Select One","Yes","No"]` while open;
  after a selection commits, stale hidden options remain in the DOM — always scope by
  exact text and verify via the button label, not by option count.
- Multi-select typeaheads (Field of Study here) stay dead as documented above; if the
  field is optional, leave it and say "No Response" is expected on Review.

### Answering SMS "Opt-In" spawns two extra required questions

- Choosing `Opt-In to receive text messages from Walmart` re-renders the questionnaire
  with two fields that did not exist before:
  1. **Confirm your 10-digit mobile phone number** — numeric only, no country code,
     no separators; and
  2. **"Are you a Indian Citizen or OCI holder?"** (options: `Indian Citizen` /
     `OCI Holder`).
- Expect the Save to fail once with those two errors if you answered Opt-In earlier in
  the same pass — fill both and re-save.

### Required consent checkbox

- `getByRole("checkbox").check({ force: true })` times out here. Find the step's single
  `input[type="checkbox"]` (light DOM on this tenant) and dispatch a DOM click; verify
  via the returned `checked`.

### Post-submit proof, three layers

1. The `jobTasks/completed/application` page renders an **"Application Submitted"**
   dialog; the underlying Candidate Home table already shows the new row (screenshot the
   row: `row.scrollIntoView({block:"center"})` then one viewport screenshot).
2. Re-opening the req's apply URL afterwards yields the dedup guard
   **"You've already applied for this job"** — a second, capture-friendly proof.
3. The receipt email (arrives in minutes) carries the `(Referral)` tag + C-number.
   Note the table's "Date Submitted" renders the tenant's US-Central calendar date,
   which can differ from the candidate's local date near midnight.

### Resume-parsed descriptions carry the PDF's hard line-wraps (verified 2026-10-06)

- The parser copies the resume PDF's ~100-char visual line breaks into Role Description
  as literal `\n`s, mid-sentence. On the `wd504` tenant the field renders with
  `white-space: normal`, so the portal **displays** flowing sentences — the wraps are
  invisible on screen and only surface on copy-out or to downstream consumers of the
  raw text. Check with `getComputedStyle(el).whiteSpace` before assuming a visible defect.
- The submitted application is **read-only** (Related Actions: View / Withdraw only —
  no edit), and this tenant has **no candidate-profile editor** (Settings holds only
  Personal Information / Change Email). Experience data pre-fills the next application
  from the last submitted one ("Use My Last Application"). So there is no in-place fix;
  the fix belongs in the fill step.
- **Normalize before typing**: when carrying parser-produced (or resume-extracted) text
  into any Workday textbox, join the visual line-wraps first — keep newlines only at
  section boundaries, then apply the illegal-character scrub. Keep a clean-text copy of
  every submitted application's role descriptions next to the artifacts so the next
  fill starts clean.
