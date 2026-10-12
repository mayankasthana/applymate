# Oracle Cloud HCM recruiting (jpmc.fa.oraclecloud.com et al.)

Covers Oracle Fusion Cloud HCM "Candidate Experience" sites: the
`hcmUI/CandidateExperience/en/sites/<SITE>/job/<reqId>` posting pages and the
`hcmRestApi` recruiting endpoints behind them. Verified on the JPMC tenant
(`jpmc.fa.oraclecloud.com`, site `CX_1001`).

## Reading the JD without full browser work

**Naive approach fails.** `curl` on the posting URL returns an empty SPA shell.
The documented details resource
`/hcmRestApi/resources/latest/recruitingCEJobRequisitionsDetails?finder=ById;...`
returns **404** on this tenant (disabled), and the item route
`/recruitingCEJobRequisitions/<reqId>` 404s too — the `PrimaryKey` finder takes
the *search row's* `SearchId`, not the requisition number, and even that item
route 404s without a session.

**Working path (search endpoint, no session needed):**

```
GET https://<host>/hcmRestApi/resources/latest/recruitingCEJobRequisitions
    ?onlyData=true&expand=requisitionList
    &finder=findReqs%3BsiteNumber%3DCX_1001%2Ckeyword%3D<term>
    %2Climit%3D25%2Coffset%3D0%2CsortBy%3DPOSTING_DATES_DESC
```

- Finder params are comma-joined; encode `;` as `%3B` inside the `finder`
  value. Params: `siteNumber`, `keyword`, `location`, `limit`, `offset`,
  `sortBy` (`POSTING_DATES_DESC` for newest-first), plus the facet params.
- Response: `items[0].TotalJobsCount` (liveness check — a keyword search for
  the req number returning count 1 confirms the posting is live) and
  `items[0].requisitionList[]` with `Id`, `Title`, `PostedDate`,
  `PrimaryLocation`, `ShortDescriptionStr`, `JobFamily`.
- This is the same call the site's own search box makes — official search,
  not bulk scraping. Keep limit modest and pace like a person.
- Full JD text is NOT in the list response (`ShortDescriptionStr` only). The
  `recruitingCEJobRequisitionsDetails` resource being 404 means full text
  needs the posting page in a browser.

## Reading the posting page in the browser

- URL shape: `https://<host>/hcmUI/CandidateExperience/en/sites/<SITE>/job/<reqId>`.
- The page renders the complete JD client-side after ~3–4 s. A `domSnapshot()`
  captures the whole thing: `Job Information` list (req id, business unit,
  posting date, **Apply Before** date, schedule, full street address) then
  `Job Description` with responsibilities and quals, then `Similar Jobs`
  (each an anchor to a sibling req — a cheap way to find related postings).
- `fullPage: true` screenshots tile the sticky header/banner on every
  viewport of this SPA (cosmetic; title + job info remain fully legible).
- The screenshot surface can time out (3000 ms) right after an SPA
  navigation and can capture an all-black frame if the tab lost the
  foreground. Recovery: re-activate the tab (`tabs.get(<verified id>)`),
  wait ~1.5 s, retry once. If the tab id is gone from `tabs.list()`, reopen
  via `agent.browsers.open(url)` (same-host reuse) — fresh page load resets
  the capture surface.
- Apply flow starts at the `Apply Now` button (two on the page: top + bottom).
  Not yet exercised end-to-end from this recipe — JPMC submissions so far went
  through it once (2026-09-28) via the sign-in path; append what you learn.

## Applying

- JPMC postings carry a hard **Apply Before** timestamp (often ~09:30 AM IST)
  and good reqs die early — check it before staging anything.
- The candidate's stored Oracle-form answers from prior JPMC applications
  (`answers list`) apply to the same tenant/site. Portal form state does not
  survive between sessions; expect a refill.

Verified: 2026-10-07 (search endpoint ×3, posting pages ×3, screenshots ×2
after the recovery dance).

## Session resets, OTP, attachments, and the step-3 parse (2026-10-13, app flow #2)

Learned on the Lead SWE 210787312 apply flow; extends the Sep 28 entries.

- **Sessions die aggressively** (~minutes of wall-clock, activity or not). A
  "Continue Working / Discard" dialog appears; once dead, Continue Working
  does nothing — the flow resets to the posting page. Re-entry is cheap and
  answer data persists server-side keyed to the email: Apply Now → email gate
  → NEXT → OTP → VERIFY → NEXT through the carried steps. Budget 60-90s per
  re-entry. The address block may come back EMPTY on a fresh session even when
  the questions carried — refill from stored answers.
- **OTP**: arrives from `eino.fa.sender@workflow.mail.us2.cloud.oracle.com`,
  subject "Take action to confirm your identity", a 6-digit code. The gate
  renders six `input#pin-code-1..6` boxes that auto-advance — focus box 1,
  `cua.click`, then `cua.type` the whole code (locator `fill` only lands one
  char). Reading the code from the candidate's inbox via read-only IMAP works
  and keeps the flow unattended (candidate-approved on 2026-10-13).
- **Honeypot discipline**: the honeypot exists only on the /apply/email screen
  (its visible label is literally "honeypot"). Email fills select the input
  whose name/id contains "email" — the honeypot never matches. Never bulk-fill
  inputs; guard every write with a zero-geometry check. The
  `g-recaptcha-response` / `h-captcha-response` textareas are standard hidden
  widget fields — never touch.
- **Attachments share ONE file input**: each DataTransfer injection fills the
  currently-open slot; the portal then relabels (a "Drop Cover Letter Here"
  slot appears). Correct order: inject resume first, wait for "Your resume was
  changed.", then the letter ("Your cover letter was changed."). If swapped
  (letter next to REMOVE RESUME), remove BOTH and re-inject in order.
  A step-1 injection may crash the SPA session without losing the upload —
  the file lands server-side; re-enter and check the attachment before
  re-uploading.
- **Step 3 parses the profile badly**: resume bullet fragments become job
  titles ("lakehouse: Hive → Delta Lake"), the employer comes out as a
  sub-brand ("DataForge"), side projects become separate jobs, education Major
  missing ("Fields to fix: 1"). Fix per entry: each Edit opens a form whose
  field ids are freshly mounted (employerName-30 → -44 → -53 → -62) — re-read
  ids on every open; native setter + input/change/blur; SAVE is per-entry
  (pick the SAVE near the open form). Delete needs no confirmation. Degree and
  Area of Study accepted free text even with the suggest service dead.
- **Suggest services can die tenant-wide** (Preferred Location, top-2
  languages combobox: "No results were found" for every query on 2026-10-13
  although both worked on Sep 28). Neither blocked NEXT — leave empty unless
  the review page flags them.
- **Screenshot surface can hard-timeout (30s) at the final step** after
  Show More — capture staged-state evidence earlier in the flow; re-activate
  + retry may still fail.
- Typeahead fields that DO accept data still commit free text with the native
  setter + input/change/blur (Degree, Area of Study verified).

