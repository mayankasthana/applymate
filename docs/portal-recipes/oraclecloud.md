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
