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
