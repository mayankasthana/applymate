# jobs.ashbyhq.com — browsing recipes

Recipes for Ashby-hosted public job boards (`jobs.ashbyhq.com/<Company>`).
Format and ground rules: [README.md](README.md). Human pacing and the
no-evasion rules in AGENTS.md govern everything here.

## Finding the board from a marketing careers page

**Goal:** reach the real, filterable job list from a company's `/careers` page.

**Naive approach fails:** many companies' marketing careers pages render the
"Open roles" heading and then nothing — the job widget is an empty
`<iframe>` in the visible DOM, and the visible page text ends with a country
dropdown (a contact form footer). Reading the page text or scrolling finds no
roles, which looks like an empty board.

**Working path:** the `<iframe src>` is the ground truth, not the page text:

```js
Array.from(document.querySelectorAll("iframe")).map(f => f.src)
```

For Cyberhaven this yielded `https://jobs.ashbyhq.com/Cyberhaven?embed=js` —
drop the `?embed=js` and navigate straight to the board. Verified 2026-10-01.

## Reading the board

**Goal:** list open roles with title + location + remote type, and get each
role's URL.

**Naive approach fails:** job links do not match `/jobs/` or `/job/` — Ashby
uses opaque UUIDs at `/<Company>/<uuid>`, so a path-based selector returns an
empty list and reads as "no openings" (the page header still says
"Open Positions (30)").

**Working path:**

```js
Array.from(document.querySelectorAll('a[href^="/<Company>/"]'))
  .map(a => ({ h: a.getAttribute("href"), t: a.innerText.replace(/\s+/g, " ").trim() }))
```

The anchor's own `innerText` is the clean title line; the following sibling
text carries `Department • Location • Employment Type • Location Type`. Note
the header text says **"Remote"** and the location may read e.g.
`Pune; EU Remote` — a Bengaluru-eligible remote req, which LinkedIn
renders as `Bengaluru East, Karnataka, India (Remote)`.

The board's own filter chips (`Location`, `Location Type`, `Department`) are
useful for counting, but reading all ~30 cards and filtering in JS is faster
and never fights the filter UI.

**Verified:** 2026-10-01, Cyberhaven board (30 openings, Staff/Principal AI
Security req located and screenshotted).

## Reading a single posting

**Goal:** pull the full JD from a posting URL of the form
`jobs.ashbyhq.com/<Company>/<uuid>` and confirm it is still open.

**Naive approach fails:** the UUID segment looks like a job ID you could validate,
but it is opaque — a wrong-but-plausible UUID renders the board shell with an empty
body, which reads as "the req is gone" rather than "you guessed wrong". There is no
404 page to distinguish the two.

**Working path:** the JD lives in the Overview tabpanel of the posting page, and the
posting's own metadata sits in a heading/paragraph grid above the tabs — `Location`,
`Employment Type`, `Location Type`, `Department`. Read the whole snapshot; it is the
complete JD and there is no separate API to hit.

**Liveness check:** the page ends with an `Apply for this Job` link
(`/<Company>/<uuid>/application`) wrapping a button. If that link is present the req
is open; if it is absent the posting has been pulled. Note that Ashby boards keep
showing a heading count even when a specific req is dead, so the count is not a
signal.

**Do not click `Apply for this Job` to test liveness** — it leaves Overview for the
application form. Read the link's presence from the snapshot instead.

Verified: 2026-10-02, Trail board (Principal Software Development Engineer,
Bengaluru, Hybrid, Engineering — Ashby-hosted, confirmed open).
