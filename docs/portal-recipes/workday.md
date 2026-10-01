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
