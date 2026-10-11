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

## Filling the application form (verified 2026-10-02, Trail)

**Resume upload:** the same React-fiber `onChange` path that works on Phenom
also works here — the IAB has no file-chooser API, but driving
`memoizedProps.onChange` on the `<input type="file" id="_systemfield_resume">`
fiber with a synthetic `{ target: { files: [file] } }` event lands the file.
**Verify via the visible filename chip, not `input.files`** — Ashby clears the
input after React consumes it, so `files.length` reads 0 on a successful upload.

**Text fields are React-controlled and resist select-all/Delete.** Clicking the
field and pressing `ControlOrMeta+a` then `Delete` left the old value, and a
retype appended rather than replaced (producing a doubled value). Use the
native value setter so React registers the change:

```js
const el = document.querySelector(sel);
const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
setter.call(el, val);
el.dispatchEvent(new Event('input', { bubbles: true }));
el.dispatchEvent(new Event('change', { bubbles: true }));
```

**UUID field ids that start with a digit are not valid CSS selectors** —
`#48be7495-…` throws `is not a valid selector`. Use the attribute form:
`input[id="48be7495-…"]`.

**After the candidate submits, the form is replaced by a confirmation page**
("Success — Your application was successfully submitted."), so every field
reads empty and the submit button is gone. That empty read is the *success*
signal, not a lost form — screenshot the confirmation immediately rather than
re-checking fields. Ashby shows no confirmation number.

**Voluntary EEO block:** the `__systemfield_eeoc_*` radio groups (gender,
race, veteran status) are explicitly optional and marked `required=false`. Set
only what's a known candidate fact (e.g. gender); leave the rest blank rather
than selecting "Decline to self-identify" on the candidate's behalf.

## Validation reads React state, not the DOM — and locator clicks time out (verified 2026-10-12, Harvey)

**Goal:** submit a fully filled form (verified 2026-10-12, Harvey tenant, end to end).

**Naive approach fails in three ways:**

1. **Locator `.fill()` can leave values the form state never sees.** On the Harvey
   form, eight of nine text fields registered through `locator.fill()`, but the
   phone field read back correct in the DOM (`el.value` right, audit clean) yet
   submit reported "Missing entry for required field: Phone Number". Ashby
   validates its React/store state, not the inputs. A DOM audit therefore does
   NOT clear a field for submit — the only real test is submitting and reading
   the correction alert.
2. **Synthetic events don't reach the state either.** Native value setter +
   `input`/`change`/`blur`, plus driving the fiber's `memoizedProps.onChange`
   with a hand-built event, all left the DOM right and the state untouched (the
   fiber call needs `preventDefault` on the fake event or it throws — and even
   then nothing registers).
3. **Playwright locator clicks time out on Ashby buttons** (`Submit Application`,
   radio inputs, options) even when the element is visible and enabled — same
   failure class as the Qualcomm Eightfold drawer. `locator.click()` on them
   burns the 3s budget and dies.

**Working path — trusted input through CUA coordinates:**

1. Get element rects via `evaluate` (`getBoundingClientRect` center). `cua.click`
   the phone field, `setSelectionRange(0, len)` via evaluate to select the stale
   text, then `cua.type` the replacement — real keystrokes over a real selection
   replace it and DO register. (`cua.keypress Meta+a` did not select; browser
   select-all shortcuts don't reach the field.)
2. The consent checkbox and both radio groups register through `cua.click` on
   their coordinates too (a real click toggles the real control — it can toggle
   an already-checked box OFF, so read back and click again if needed).
3. Submit by `cua.click` on the Submit Application button's coordinates.
4. Success: the tabpanel is replaced by `status: "Success" — Your application was
   successfully submitted. We'll contact you if there are next steps.` URL
   unchanged, no confirmation number. If instead an `alert "Your form needs
   corrections"` renders, its buttons name the offending fields — fix those and
   resubmit; the alert is regenerated fresh on every attempt.
5. A failed submit does NOT wipe the attachments — the resume filename chip
   survived all three submit attempts.

The file upload itself still lands via the DataTransfer/fiber path from the Trail
entry above — only *state-carrying text/choice fields* need the trusted-input path.
