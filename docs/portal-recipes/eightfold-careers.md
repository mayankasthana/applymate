# careers.* Eightfold boards — searching and liveness-checking

Recipes for Eightfold-hosted corporate career sites (`careers.<company>.com`).
Format and ground rules: [README.md](README.md). Human pacing and the no-evasion
rules in AGENTS.md govern everything here.

Seen on: careers.amgen.com (Eightfold, verified 2026-10-02).

## Finding a req by keyword when the search box lies

**Goal:** confirm that a req you were handed (often from an aggregator) is really
live on the company's own board, and find its requisition number.

**Naive approach fails:** the KEYWORD box is a loose semantic match, not a title
match. Searching `Senior Software Engineer` on Amgen returned two results, neither
of them a senior software engineer — one was a Boston data scientist and one was an
Arizona pharmaceutical sales rep. Searching the requisition number itself
(`R-247078`) returned **0 results**, because Eightfold does not index req IDs into
the keyword field. Both outcomes read as "the req does not exist" and are wrong.

Worse, the **LOCATION box silently auto-fills a US city** (it populated `Tempe, AZ`
from nothing). Typing `Hyderabad` into it leaves the text in the box but never
commits a location filter, so the results stay US-scoped while the header reads
"…in Hyderabad". That mismatch is the tell that the box did nothing.

**Working path — filter the country facet first, then search:**

1. Dismiss the cookie banner. It renders as `#system-ialert` and **physically covers
   the SEARCH JOBS button**, so clicks on it time out with
   "waiting for click actionability (covered by <div id="system-ialert">…)".
   `getByRole("button", { name: "Decline" })` dismisses it.
2. Expand the facet you need: `getByRole("button", { name: "Select a Country" })`.
   The facet bodies are collapsed by default, so a label you can read in the DOM can
   still be non-clickable.
3. Click the facet **label text**, not the checkbox. The checkbox is visually hidden
   (`cbVisible: false`) so both `check()` and `setChecked()` fail with
   "actionability (hidden)"; the surrounding `<label>` is the real click target.
   Amgen: `getByText("India 653")`.
4. Now search. With Country=India (653 openings on Amgen), `Senior Software Engineer`
   returned the real Hyderabad reqs immediately.

**Reading results:** `a[href*="/en/job/"]` gives every card; the card's `innerText`
is `Mon. DD, YYYY <Title> <Location>`. Job URLs are
`/en/job/<city-slug>/<title-slug>/87/<internal-id>`.

**Reading a job page:** `document.body.innerText` sliced from `indexOf("JOB ID:")`
gives the authoritative block — `JOB ID`, `LOCATION`, `WORK LOCATION TYPE`,
`DATE POSTED`, `CATEGORY` — then the full JD. This is the liveness check: the req
number, the work-location type and the posted date all come from the source board,
not from an aggregator that copied them.

**Watch `WORK LOCATION TYPE`.** Amgen listed `On Site` for Hyderabad while the
aggregator copy said nothing about work mode. The source board is the only place that
field is authoritative, and it is frequently the thing that decides whether a req
clears the candidate's work-mode gate.

**Verified:** 2026-10-02, careers.amgen.com — country-facet-then-search located
R-247078 and R-246929 among 653 India openings; both confirmed live on-page.

## Qualcomm: the board that needs a wider window, and hides India in the location box

**Goal:** sweep careers.qualcomm.com for India engineering openings without a
country facet. Qualcomm's Eightfold tenant has **no country/location facet at
all** — `All Filters` exposes only **Department, Skills, and Seniority**.

Verified 2026-10-04, careers.qualcomm.com.

**The location box lies in the opposite direction from Amgen's.** Typing
`Pune` or `India` into `Search for location` returns a dropdown reading
**"No results"** — which reads as "this board has nothing in India" and is wrong.
The value still commits: the URL silently gains `&location=India`, and results
drop to India. So: type the country, ignore the "No results" dropdown, and verify
the commit by reading `location.href` for `location=`. Never trust the dropdown,
and never conclude a req is absent from this board because location search found
nothing.

**The filter drawer renders off-viewport and silently breaks every locator.** The
`All Filters` drawer is a 480px right-hand panel. At the default 1280px window it
lays out at **x=1328 — past the right edge**, so the facet `<label>`/`<li>` nodes
report `width: 0, height: 0` and *every* Playwright click times out with
"waiting for click actionability" or "Playwright pointer probe returned no click
point". Widen first:

```js
await tab.setViewportSize({ width: 1920, height: 1080 });   // panel then sits at x=1440
```

Do this before touching `All Filters`. A timeout here is a layout bug, not a
missing element — never conclude the facet is absent.

**Locator strategy on this tenant:** `getByRole(...).click()` and `cua.type()`
both time out even when the element is visible and unobstructed.
`locator.fill(...)` works, and `cua.click({x, y})` works. So read the element's
`getBoundingClientRect()` via `evaluate`, then `cua.click` its centre. Click the
**accordion first** (`Department` / `Skills` / `Seniority`, at y≈111/182/253 in
the 1920px layout) — the facet bodies are collapsed and read `width: 0` until
expanded. Click the **label text**, not the checkbox.

**The keyword box ignores Enter.** `fill()` the keyword box, then click the
**`Search jobs` button**; Enter does nothing and the results never change. The
committed search shows up as `&query=...` in the URL — read the URL to confirm a
search actually ran rather than trusting the result list, which silently stays
unfiltered.

**Result cards are read from `a[href*="/careers/job/"]`.** Each `innerText` is
`Title | Location | Job Area | Posted …`. Pagination is a "Load more" scroll, so
the DOM holds one page (~20) at a time — re-read after each scroll rather than
assuming you have the whole set.

**Job detail:** `https://careers.qualcomm.com/careers/job/<pid>?hl=en-US`. The
authoritative **Job ID** (e.g. `3082527`) is in the page body, distinct from the
`pid` in the URL — cite the Job ID, not the URL id, when checking a req is live.

**Qualcomm posts the same JD under several title bands — dedupe on text, not id.**
Req `446715641036` (Job ID 3082527, "Engineer/ Sr Engineer/ Lead Sr Engineer, AI
Platform Development", Pune) and req `446719431947` (Job ID 3093379, "Lead
Architect – AI Platforms & Distributed Systems", Pune) carry **verbatim
identical** JD bodies. They are one job posted at two title bands. Catch this by
comparing JD text, because the job IDs and URLs differ and nothing else flags it —
and it matters: applying to both reads as two strangers to one recruiting org.

**Cookie banner:** OneTrust, `#onetrust-accept-btn-handler`. The button is
visually present but not clickable (click timeouts); dispatch it via `evaluate`
(`b.click()`) and remove `#onetrust-consent-sdk` before screenshotting, or the
banner sits over the JD body.

## Aggregator boards are leads, not evidence

**Goal:** liveness-check a req that arrived via a third-party job board.

Bioksha (bioksha.in) posted Amgen's R-247078 with a full, accurate JD copy but no
req URL. The company name, req number and location were all recoverable and the
aggregator turned out to be correct — but only because the source board was opened
and checked. Aggregator pages carry no liveness signal: postings there outlive their
req by weeks. Per the standing `livenesscheck` preference, always resolve to the
company's own board before any portal work.
