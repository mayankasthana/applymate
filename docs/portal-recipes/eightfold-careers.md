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

## Aggregator boards are leads, not evidence

**Goal:** liveness-check a req that arrived via a third-party job board.

Bioksha (bioksha.in) posted Amgen's R-247078 with a full, accurate JD copy but no
req URL. The company name, req number and location were all recoverable and the
aggregator turned out to be correct — but only because the source board was opened
and checked. Aggregator pages carry no liveness signal: postings there outlive their
req by weeks. Per the standing `livenesscheck` preference, always resolve to the
company's own board before any portal work.
