# deshawindia.com — D. E. Shaw India careers board

Mechanics of the public careers board (`https://www.deshawindia.com/careers`).
No candidate facts. Verified 2026-10-04.

## Reading the board

- The whole board is one page with category/location dropdowns ("I am
  interested in ___ at your ___ offices"). A counter reads
  `Viewing 4 of 78 Jobs`, and a `+74 Jobs` load-more element sits below the
  visible cards.
- **The counter lies about what is in the DOM.** After switching category,
  every job card for the selected category is present in the page as
  `<a href="/careers/<slug>-<id>">` even while the counter still says
  "Viewing 4 of N" and only 4 cards are visibly rendered. Collect the full
  list with one `evaluate` over `a[href*="/careers/"]` (filter the nav
  links: `/careers/faq`, `/careers/campus`, …) — do not bother with the
  load-more control. The `+N Jobs` paragraph is not reliably clickable
  (locator click times out waiting for actionability).
- Job detail pages are `/careers/<slug>-<numeric-id>` and are plain
  server-rendered text. The JD body sits between the job-title heading and
  the `Candidates with relevant experience…` legal boilerplate — slice
  `document.body.innerText` between those two anchors.

## Switching category (the dropdown fights Playwright)

**Naive approach fails** (verified 2026-10-04, IAB): the filter is a custom
dropdown, not a native `<select>`. The first click after page load works, but
subsequent `getByRole("button", { name: "open category options" })` clicks and
`getByRole("option", …)` clicks time out waiting for actionability — the
options stay "visible" in the ARIA tree but don't receive pointer events.

**Working path:** dispatch the same clicks from page context:

```js
// open the dropdown
await tab.playwright.evaluate(`(() => {
  const btn = Array.from(document.querySelectorAll('button')).find(b =>
    (b.getAttribute('aria-label') || '').includes('open category options'));
  if (btn) btn.click();
})()`);
// wait ~400ms, then click the option
await tab.playwright.evaluate(`(() => {
  const opts = Array.from(document.querySelectorAll('*')).filter(e =>
    e.children.length === 0 && (e.textContent || '').trim() === 'Core Tech');
  opts[opts.length - 1].click();   // LAST match, see below
})()`);
```

- **Take the last matching element for the option.** Category names also
  appear as marketing nav links elsewhere in the page (e.g. "Financial
  Research" exists both as an option and as a `/what-we-do/financial-research`
  nav link). The first match is the nav link and navigating away loses the
  filter; the last match is the actual listbox option. Check `location.href`
  after clicking to confirm no navigation happened.
- State is observable from `document.body.innerText`: the selected category
  text sits right after "I am interested in", and the counter reads
  `Viewing N of M Jobs` for the active filter.

## Board shape (2026-10-04)

Categories on the India board: Fresh Graduate Roles, Administration,
Core Tech, Financial Operations, Financial Research, Front Office Tech,
Human Capital, Legal, Product Management, Project Management Office,
Quality and Test Engineering, Systems. Engineering IC reqs live almost
entirely in Core Tech (23 reqs); Front Office Tech had exactly 1; Systems is
IT-infra/SRE track; Financial Research is analyst roles. There is no pay
information anywhere on the site — postings state no compensation.

## The apply flow (added 2026-10-04, verified end-to-end on the GAITech Strike req)

### There is an "application bundle" — do NOT add a second req

The job page footer carries two controls, and the distinction matters when the
candidate's standing rule is one application per company:

- **"Apply Now"** — applies to *this* req only. The req id lands in the URL.
- **"Add job to your application bundle"** — accumulates multiple reqs into one
  application. Using it sends several reqs to one recruiter org at once, which
  reads as spray. Prefer "Apply Now" unless the candidate asks for a bundle.

### Navigating straight to the apply URL silently fails

`goto("https://www.apply.deshawindia.com/ApplicationPage1.html?entity=DESIS")`
redirects to `apply.deshawindia.com/timeout.html`, title "Timeout - D. E. Shaw
India" — an empty page, **not an error**. Read `location.href` before
concluding anything about the form.

**Working path:** load the job page, then click the real "Apply Now" link. The
click carries the session and appends the req id:

```
https://www.apply.deshawindia.com/ApplicationPage1.html?entity=DESIS&source=Website&jobs=<reqId>
```

`jobs=6840` confirmed the Strike req. The header panel ("You are applying for
the following positions: …") is the authority that the right req is bound —
read it before filling anything.

### The cookie banner blocks every footer click

`button "Accept All" / "Decline All"` renders as a fixed overlay covering the
sticky footer bar, so the first `Apply Now` click times out on actionability
with a "covered by Cookie Banner" error. Dismiss the banner first, then click.
("Decline All" keeps essential cookies including security — the site says so —
and declines third-party analytics.)

### Every select on this form is a react-select, and a selection is invisible in the input

`Current Location`, `University`, `Degree`, `Field of Study`, `Employer Name`,
`Honors` are react-select components. **After a successful pick the text input
reads empty** — the search input and the committed value are different nodes.
Reading `input.value` therefore reports a failure that did not happen.

Verify with the selected-value node and the wrapper class instead:

```js
const sel = document.querySelector('#currentLocation').closest('.Select');
sel.querySelector('.Select-value-label')?.innerText   // "Bengaluru"
sel.className.includes('has-value')                    // true
```

### The option grid eats locator clicks — dispatch the triple

`getByRole("listbox").getByText("Finance").click()` times out: the option sits
under a `ReactVirtualized__Grid` overlay that Playwright treats as covering.
Dispatch from page context, taking the LAST exact-text match:

```js
const lb = document.querySelector('[role="listbox"]');
const m = Array.from(lb.querySelectorAll('*'))
  .filter(e => e.children.length === 0 && (e.textContent || '').trim() === 'Finance');
const t = m[m.length - 1];
['mousedown','mouseup','click'].forEach(ty =>
  t.dispatchEvent(new MouseEvent(ty, { bubbles: true, cancelable: true, view: window })));
```

### The option search matches full text, not acronyms

Searching a react-select for `MBA` returns only
`International Master of Business Administration (IMBA)`. The plain
`Master of Business Administration` does not contain the string "MBA" and only
appears when searching `Admin` or `Business`. Search a real word from the
option text.

### "Field of Study (Max 2)" does not accumulate

Despite the Max 2 label, the control is single-select in practice: picking
`Finance` **replaced** `Information Technology`. Worse, clicking the
`"Add Field of Study"` button silently rewrote the committed value to
`Information Security` — an unintended selection with no error. After any change
here, re-read all `.Select-value-label` values and confirm what actually stuck.
Add the second subject only via the Add button, then re-verify.

### `datePosted` is regenerated on every render — do not read it as a repost date

All three DE Shaw reqs return `datePosted` within one second of each other on
separate requests, which means the site stamps a fresh timestamp per page
render. It is **not** evidence that an individual req was refreshed or is
actively hiring. Use HTTP status plus the absence of "no longer exists" /
"position closed" markers as the liveness check, and say nothing more.

### The whole form can sit scrolled off the left edge

The application page lives inside `div.template.ApplicationTemplate`, which is
**itself horizontally scrollable** (`scrollWidth` ~2283 against a 1280
`clientWidth`). If it ends up with a non-zero `scrollLeft` — a stray horizontal
wheel/trackpad gesture during automation does it, and so does any horizontal
scroll you issue while aiming at a control — the entire form renders shifted
left and the **left third of every field, including the labels, is invisible**
with no horizontal scrollbar to recover it: `document.documentElement.scrollWidth
=== clientWidth`, so `window.scrollX` can never move.

The symptom is easy to misread as a broken page rather than a scrolled one.
Read `document.querySelector('.template.ApplicationTemplate').scrollLeft` when
the layout looks wrong, and reset it:

```js
document.querySelector('.template.ApplicationTemplate').scrollLeft = 0;
```

Verify by `#main-container`'s rect x returning to ~157 (it reads **negative**
when shifted). Re-check it after any long interaction sequence — it can drift
again — and re-zero before reporting a visual state to the candidate.

### `Add Another Employer` sits ~2000px down the page — never click it blind

The add/remove controls are `div.add-another[role="button"]`, and **four**
elements share that class across the form (Add Honors, Add Education, Add
Another Award, Add Another Employer), so a class-scoped locator resolves to 4.
Scope by the visible text instead, `scrollIntoView({block:'center'})` first, and
only then read the rect and click:

- The employment-history button measured **y≈2001** with a 720px viewport — far
  below the fold. `getByRole('button', {name})` times out on actionability
  because it is off-screen.
- Clicking a *previously measured* coordinate after the page has scrolled is
  unsafe: the same point lands on a different control. A stale coordinate in
  this form hit **"Remove Employer"** and silently deleted a filled employment
  record. Always re-measure immediately before clicking, and audit the records
  afterwards rather than trusting the earlier fills.
- Custom employers (anything absent from their normalized list) need the
  no-results link "Click here to add it", which sets the select to `Other` and
  reveals a free-text input named `#employerName-<recordIndex>`. Typing into the
  typeahead afterwards overwrites that name with the search string — fill the
  custom-name input **last**.

### Submission confirmation — a green page and no reference number

Finishing the form navigates to
`https://www.apply.deshawindia.com/application-success.html`, title
"Success - D. E. Shaw India", rendering a green panel:

> **Submission Success** — "Your application has been successfully submitted.
> Press any key or click here to go to the HOMEPAGE"

**No application id, requisition reference or confirmation number is issued** —
like Lever, the success page itself is the only proof, so screenshot it as the
`submit-screenshot` evidence and pass `--confirmation "(none issued)"` to
`app submitted`. Do not go looking for a number on a follow-up screen; there
isn't one, and the page offers only a link back to the careers homepage.

The `Finish` control is a `div.button-big.button-big-next.right-aligned` at the
very bottom of the single page (~y 2328 before scrolling), not a `<button>`.
Scroll it to `block:'center'`, re-measure, confirm
`document.elementFromPoint(cx, cy)` is the div itself, then hover-travel and
click. Verify the outcome by `location.href` ending in `application-success.html` —
a click that silently fails leaves the form fully populated and looks untouched.
