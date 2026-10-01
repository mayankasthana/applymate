# atlassian.com — browsing recipes

Recipes for Atlassian's own careers site (not the underlying ATS).
Format and ground rules: [README.md](README.md).

## Liveness-checking a req (the "is this posting still up" check)

**Goal:** confirm a LinkedIn-mirrored Atlassian req still exists on Atlassian's
own site, and capture its canonical URL.

**Naive approach fails:** `/company/careers/all-jobs` gates the list behind two
checkbox filters ("WHAT FUNCTION MATCHES YOU?" / "WHERE ARE YOU ELIGIBLE TO
WORK?"). Every attempt to drive them fails:

- `getByText("Engineering (106)", { exact: true })` → click times out.
- `locator("label", { hasText: "Engineering (106)" })` → **38 matches**
  (the filter labels are duplicated per locale/route).
- hover-travel + `cua.click` on the label's rect → no state change;
  the underlying checkbox stays `checked: false`.
- `input[name="job_location"]`-style checkboxes here have **zero-size rects**
  (`getBoundingClientRect()` → 0,0), so coordinate and `setChecked` both fail.

Do not spend time on the filters.

**Working path — the job cards are already in the DOM, ungated:**

```js
Array.from(document.querySelectorAll('a[href*="/company/careers/details/"]'))
  .map(a => ({ h: a.getAttribute("href"), t: (a.innerText || "").replace(/\s+/g, " ").trim() }))
```

Dedupe by href. ~337 cards render at once, covering every Atlassian opening
globally, so "does this req exist" and "what else is open" are both answered
without touching the filter UI. Scroll in steps first if you want the full
set; the list renders well past one viewport.

**Gotcha:** do **not** widen the ancestor to the card (`a.closest("li")`) to
capture location — the row element spans several sibling jobs, so every entry
comes back with the same concatenated text and the titles look wrong. The
anchor's own `innerText` is the title; location comes from the detail page.

**Detail page** (`/company/careers/details/<id>`) carries the authoritative
header line — `Function | Location | Remote, Remote | Full-Time` — which is
what settles "is this actually remote?". Verified 2026-10-01 on req 26577
(`Senior Principal Software Engineer, Jira Data Management`, "Bengaluru,
India | Remote").

**Verified:** 2026-10-01, atlassian.com careers, 2 reqs confirmed live.
