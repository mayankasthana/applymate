# salesforce.com careers — JD pages and the jobs search

Format and ground rules: [README.md](README.md). Human pacing and the
no-evasion rules in AGENTS.md govern everything here.

## Reading a posting (JD pages)

**Goal:** read a req's JD + capture liveness evidence on
`salesforce.com/company/careers/jobs/JR…/<slug>/`.

**Working path:** the JD renders fully in `document.body.innerText` — no
hydration games, no long/short URL split. The header block carries the
liveness fields together: team, `India - <city>`, `Full time`,
`Posted <DD Month YYYY>`, and the `JR<id>` (that posted date is the capture
date `job evidence` wants). `fullPage` screenshots succeed.

**Traps:**

- Playwright locator clicks stall on these pages (the header micro-renders) —
  `getByRole("link", { name: "Search jobs" }).click()` times out while the
  link is visible in the snapshot. Aim by coordinates instead: in a 1280px
  viewport the `Search jobs` button sits at ≈(1163, 109). `cua.click` lands it.
- The careers header is shadow-DOM'd: `document.querySelectorAll("a")` finds
  **no** "Search jobs" anchor, so the href is not extractable — don't look
  for it, click the pixels or navigate the URLs below.
- The "Need help? Ask Agentforce" chat widget overlays the lower right; it
  does not cover the header facts or the JD body.

## Searching the board (jobs search page)

**Goal:** find sibling reqs by keyword and location.

**Naive approach fails:** on `/company/careers/jobs/`, filling the visible
keyword box and pressing Enter does nothing — the URL stays clean and the
"results" are the unfiltered recommendation rail (sales roles and all). The
box you typed into is a vendor widget (`#vendor-search-handler`), not the
real form field. Guessing `/company/careers/search/` 404s.

**Working path:** the page is a plain **GET form**
(`action=/company/careers/jobs/`, fields `search`, `country`, `region`,
`location`, `team`, `contractTypes`, `employeeTypes` — the `<select>`s are
native and carry every city/country as options). Navigate the form action
directly with its own params:

- `https://www.salesforce.com/company/careers/jobs/?search=python&location=Pune`
- `https://www.salesforce.com/company/careers/jobs/?search=python&country=India`

Results render as `a[href*='JR']` cards (team / title / `India - <city>`),
and the result count is stated in the page text ("7 Results"). The keyword
match is loose — `search=python` surfaces consultant and PMTS reqs that
merely mention Python — so read the titles and open the engineering ones.

**Verified:** 2026-10-14 — JR354838 page read + fullPage shot; search
?search=python&location=Pune (7 results) and ?search=python&country=India
(10 results); `Search jobs` reached via cua click at (1163, 109).
