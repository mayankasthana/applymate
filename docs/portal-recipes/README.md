# Portal recipes — never re-derive a portal another session already cracked

This directory is the **committed** library of browsing recipes: the URL
patterns, selectors, event sequences, and pacing that make difficult sites
workable with the harness's browser tools. The AGENTS.md contract ("Browser
recipes" section) makes using it mandatory in both directions:

- **Read before you browse.** Before opening any page — job board, career
  portal, ATS apply flow, LinkedIn, mail web UI — check the index below and
  read the file for that domain. Follow what it says; only experiment where
  it is silent.
- **Write after you solve.** When something does not work the obvious way
  (click ignored, upload swallowed, widget invisible, dialog that eats
  events, flow that resets) and you find a path that works, add the recipe
  to the domain file immediately — without being asked — and commit it:
  `docs(recipes): <domain> — <what was learned>`.

## Files

One file per site family, named for the **domain, not the company** — most
employers share an ATS, so a `workday.md` recipe serves every Workday tenant:

| file | covers | last verified |
|---|---|---|
| [ashby.md](ashby.md) | jobs.ashbyhq.com boards — finding the board from a marketing careers page, UUID job links, reading roles + remote type, single-posting JD + liveness | 2026-10-02 |
| [atlassian.md](atlassian.md) | atlassian.com careers — liveness-checking a req, bypassing the unusable function/country filters, remote confirmation | 2026-10-01 |
| [deshawindia.md](deshawindia.md) | deshawindia.com careers — the counter lies (all category cards are in the DOM), category dropdown ignores locator clicks (evaluate-dispatched clicks; last-match wins over nav links), JD body slicing, no pay info on the site | 2026-10-04 |
| [eightfold-careers.md](eightfold-careers.md) | Eightfold `careers.<company>.com` boards — country-facet-then-search (the keyword box is semantic and the LOCATION box self-fills), hidden facet checkboxes, per-job liveness fields | 2026-10-02 |
| [greenhouse.md](greenhouse.md) | greenhouse.io job boards — typeahead flyout fields, chip-selection verification, DataTransfer resume upload, submit/confirmation flow | 2026-10-01 |
| [gmail.md](gmail.md) | mail.google.com — read-only IMAP via app password, confirming vs knock-out rejection classification; composing and sending with attachments via DataTransfer injection + loopback byte server | 2026-10-02 |
| [icims.md](icims.md) | icims.com — iframe traversal (`icims_content_iframe`), GDPR/hCaptcha handling, candidate profile updates, verification | 2026-10-01 |
| [lever.md](lever.md) | jobs.lever.co apply forms — the `/searchLocations` typeahead contract (hidden `#selected-location` JSON is what the POST validates; blur clears it), failed-submit wipes the DataTransfer resume attachment (attach last), programmatic radio clicks, native-dialog cookie banner | 2026-10-04 |
| [linkedin.md](linkedin.md) | linkedin.com — messaging, connection invites (people-search card extraction from `/in/` anchors), job-card interactions, reading job descriptions (the JD endpoint curls without a browser session; applicant counts differ by source), sweeping new postings via the guest search endpoint (the classic search UI is retired and dead), verification discipline | 2026-10-04 |
| [mimecast.md](mimecast.md) | careers.mimecast.com — WebFetch 403 workaround, reading a posting's JD + posted date, Workday apply-URL shape | 2026-10-02 |
| [phenom.md](phenom.md) | Phenom "pcsx" apply portals and public job boards (jobs.autodesk.com, jobs.twilio.com et al.) — resume upload, reload behavior, click fallbacks, search/facet UI | 2026-10-01 |
| [smartrecruiters.md](smartrecruiters.md) | api.smartrecruiters.com — reading a posting's JD without a browser, board search to liveness-check an aggregator link, the `jobAd.sections` dict shape | 2026-10-02 |
| [stripe.md](stripe.md) | stripe.com/careers — reading a posting + liveness (apply link), sidebar Office location field, the EU-applicant-notice tell, the 100%-in-office boilerlist trap, searching by function to find a location-clean sibling req, and the Greenhouse apply embed (iframe won't attach — open the src directly; react-aria zero-size search inputs) | 2026-10-03 |
| [workday.md](workday.md) | Workday recruiting (myworkdaysite.com) and public careers boards (myworkdayjobs.com) — apply-flow URLs, shadow-DOM form filling, account-creation recovery, duplicate-application detection, the `wday/cxs` JSON endpoint for reading a JD with no browser, and the `jobs` POST endpoint for bulk-sweeping a country | 2026-10-03 |

## Recipe format

Each entry in a domain file carries:

- **Goal** — what you were trying to do.
- **Naive approach fails** — what happens if you do the obvious thing.
- **Working path** — the recipe itself: exact URLs, selectors, event
  sequences, waits and pacing. Concrete enough that the next session can
  follow it without re-experimenting.
- **Verified** — date and how many times it worked. If it later breaks, mark
  it `BROKEN as of <date>` and keep the entry; the failure mode is
  information too.

## Ground rules

- **Mechanics only.** No credentials, cookies, tokens, form answers, or
  anything candidate-identifying — this directory is committed, and prime
  directive 5 (personal data stays local) still governs.
- **Cooperation, not evasion.** A recipe documents how to work *with* a site
  at human pace. CAPTCHAs, verification challenges, and block pages still go
  to the candidate; no stealth, fingerprint, header, or proxy tricks ever
  (see "Act like a careful human in the browser" in AGENTS.md).
- **Append, don't fork.** Same domain already has a file? Merge the new
  trick into it and dedupe. An apparent contradiction means re-verify and
  correct the old entry — not a second competing one.
