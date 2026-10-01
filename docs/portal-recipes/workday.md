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

## General discipline on this tenant

- One state change per observation, screenshot after every click (buttons move with scroll).
- `waitForTimeout` 2–4 s after navigation; the SPA hydrates late (snapshots taken too early show an
  empty main region).
- Email round-trips (reset links) are readable read-only via the candidate's mailbox if the
  candidate has approved that channel; never guess token URLs.
