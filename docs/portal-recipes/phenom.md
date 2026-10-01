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

## Liveness checks are NOT valid server-side (jobs.ebayinc.com, 2026-10-01)

**Goal:** decide whether a req is still open before applying or sending a
referral (the standing `livenesscheck` / `outreachverification` rules).

**Naive approach fails — this one produces confident wrong answers.** A plain
`curl` of a job URL and a check for the delisted string
(`This job listing is no longer available, but we have many more`) is useless
here. That domain's SSR returns **that exact page for every job detail URL**,
open or closed. Measured across four reqs in both URL formats
(`/us/en/job/R0076802/Sr-MTS-AI-Platform` and the longer
`EBAEBAUSR00…EXTERNALENUS/…` form): R0076802, R0076807, R0076436, R0076268 —
**all four** returned a byte-identical ~1.4 KB visible-text page whose only
sentence is the delisted notice, at the same offset (1246–1262). Two URLs that
are certainly live render exactly like two that are certainly dead.

The **search list is not a liveness signal either**: `/us/en/search-results`
hydrates client-side (297 jobs, real cards) and happily lists reqs whose detail
page is closed. Presence in the list only means "was indexed at some point".

**Working path — a liveness check here needs a human, or an explicit opt-out:**

- Don't let a server-side string match decide. Treat any automated eBay
  liveness result as unproven, and say so rather than reporting a verdict.
- Hand the candidate the req URL and ask them to open it and confirm an Apply
  button is present; they are logged in and it is one click.
- A referral that depends on a live req (`outreachverification`) should not
  go out on a machine-checked verdict from this domain.

**Note on hydration (IAB, 2026-10-01):** the search page hydrates fine, but the
job detail page **in the long URL form** does not paint — `<title>` is correct
(`MTS 2, AI Platform in Bengaluru, India | Engineering at eBay`), yet
`document.body.innerText` stays ~22–362 chars (chatbot chrome only) after 8 s,
with the JD and Apply button absent. So even the browser route may not resolve
it client-side; `dom_cua`/hover-travel clicking into the card does navigate
(the URL and title change) but the content still does not render. `evaluate`
hits for "Apply Now" only find unhydrated template literals
(`aria-label="Apply Now for ${jobDetail.jobSeqNo}"`) in the app bundle — not a
real button. Read this as a portal limitation, not as proof of death.

**CORRECTION (2026-10-01, later): the detail page DOES paint — use the short URL
form.** The failure above is a property of the **long**
`…/job/EBAEBAUSR<seq>EXTERNALENUS/<slug>` form, not of eBay. The short
`…/job/R<seq>/<Slug-Cased-Title>` form hydrates normally. Verified on
`/us/en/job/R0076710/Unified-Data-Platform-Architect`: after ~4 s,
`document.body.innerText` was the full 8.4 KB posting including "Minimum
Qualifications", "Core Technology Areas" and a real **Apply Now** button. The
same page's `fullPage`/`clip` screenshot calls both died with
"browser screenshot surface preparation timed out after 3000ms", so on this
domain prefer `evaluate`-ing `document.body.innerText` for the JD over trying to
screenshot it; file the captured text as `job evidence … --kind jd-snapshot`.

**The apply flow is the reliable liveness probe on both URL forms.** Navigating
to `…/apply?jobSeqNo=<seq>&step=1&stepname=personalInformation` resolves and
renders a header reading `You are applying for -<title> (<req>)`. For
R0076802 this confirmed the req live after the detail page had refused to paint
— the detail page failing to hydrate says nothing about whether the req is open,
and the apply flow is the thing to trust.

