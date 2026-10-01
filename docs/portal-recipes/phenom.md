# Phenom portals ("pcsx" apply flows) — browsing recipes

Covers career portals built on Phenom People (e.g. jobs.autodesk.com and
other `/pcsx/` apply flows — several large employers run Phenom). Format
and ground rules: [README.md](README.md).

## Resume upload (the antd Upload swallows synthetic input)

**Goal:** attach the resume PDF so the portal's parser autofills the form.

**Naive approach fails:** React app; the hidden `<input type=file>` is not
framework-bound, and a `DataTransfer` + change/drop does nothing. The
uploader is an antd Upload whose `beforeUpload` swallows synthetic input
silently.

**Working path:** read the PDF in Node, base64 it, then in one `evaluate`
call build a `File`, walk the input's React fiber
(`__reactInternalInstance$…`) up to the antd Upload fiber
(`memoizedProps.beforeUpload`), and call its
`stateNode.post({ origin, parsedFile, action, data })` directly — the XHR
hits `/api/application/v2/resume_upload` and the server parses + attaches
the resume to the candidate session (the `profile` API shows
`hasResume`/`resumeFilename`). Reload the page afterwards: the UI chip
appears and parsed contact fields autofill.

## Reload behavior

**Naive approach fails:** reloading at the wrong moment wipes work.

**Working path:** **reloading clears the question answers** (contact
refills; dropdowns don't) — re-answer after any reload, and **never reload
between staging and Submit**.

## Clicks

**Naive approach fails:** Playwright locator clicks time out on these
portals (constant micro-renders).

**Working path:** read rects via `evaluate` and click via `cua`
coordinates (the hover-travel + click pattern from
[linkedin.md](linkedin.md) is compatible).

## Search & facet UI on a public job board (jobs.twilio.com, 2026-10-01)

**Goal:** run a keyword search and narrow by location on the board itself.

**Naive approach fails — three separate traps:**

1. **Filling the keyword box and pressing Enter does not search.** It opens the
   typeahead instead; the result count stays at the unfiltered total
   (`127 jobs`) and the URL keeps its original `?start=0&pid=…` params. Read
   the job count after pressing Enter — if it didn't change, the search
   never ran. **There is a visible `Search jobs` button; that is what
   submits.**
2. **Location facet checkboxes are visually hidden** — `input[name="job_location"]`
   has `value="remote - india"` and a **zero-size rect**, so `check({force})`
   times out and `setChecked` fails. Expanding the facet button does not give
   them a size either.
3. **Locator clicks stall on the whole board** (the phenom behaviour above);
   only `cua` clicks land.

**Working path:** skip the facets entirely and run the keyword search, then
read every rendered card's `innerText` — each card already carries
`Department • Location • Remote|On-site • Posted …`, which is enough to filter
in JS:

```js
Array.from(main.querySelectorAll("a[href*='/careers/job/']"))
  .map(a => a.innerText.replace(/\s+/g, " ").trim())
```

That turned "20 results for Principal Engineer" into the India-eligible subset
(`Remote - India`) without ever touching the location facet. Click the
`Search jobs` button by rect + `cua` when you do need a keyword filter.
