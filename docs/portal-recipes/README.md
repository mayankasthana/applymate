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
| [linkedin.md](linkedin.md) | linkedin.com — messaging, connection invites, job-card interactions, verification discipline | 2026-10-01 |
| [phenom.md](phenom.md) | Phenom "pcsx" apply portals (jobs.autodesk.com et al.) — resume upload, reload behavior, click fallbacks | in the field; date not recorded |

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
