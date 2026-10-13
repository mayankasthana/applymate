# AmbitionBox salary pages (ambitionbox.com) — reading India compensation

India-focused comp aggregator. Verified 2026-10-14 on MasterCard
(`ambitionbox.com/salaries/mastercard-salaries/...`) via plain curl, no login.

## Goal

Sourced salary bands for a company's India ladder rungs, with sample counts —
the legitimate input for `job pay --low --high --currency INR --source <url>`
(AGENTS.md "Pay figures on the board").

## Naive approach fails

- levels.fyi and Glassdoor both dead-end for non-browser fetches: levels.fyi
  serves a Next.js shell (`__NEXT_DATA__` present, zero server-rendered
  figures), Glassdoor answers HTTP 403. Per the browsing rules neither is
  worked around — AmbitionBox is the source that just opens.
- The index page's role cards and its embedded JSON-LD list don't line up with
  the ranges (role names detach from the ₹ figures when you strip tags by
  line), so naive pairing produces wrong role→range matches.

## Working path

1. Index: `GET https://www.ambitionbox.com/salaries/<company>-salaries` with a
   browser UA → HTTP 200, fully server-rendered (~450 KB).
   - The `top roles` table carries `<td>ROLE</td><td>₹X Lakhs to ₹Y Lakhs per
     year</td>` rows (regex-parseable when you unescape entities first; keep
     rows, don't split by blank lines).
   - A JSON-LD `ListItem` breadcrumb lists every role sub-page:
     `"url":"/salaries/<company>-salaries/<slug>","name":"MasterCard <Role>"` —
     use it to find e.g. a data-engineer page when the index top-roles table
     omits it.
   - Headline sample size sits near "based on data from 13.6k salaries
     submitted by ... employees" — quote it with the figures.
2. Detail page per role (`.../<slug>`): the usable block is
   **"Salaries by years of experience"** — one row per band
   (`9 - 12 years | 140 salaries | ₹ 44.4 L/yr – ₹ 49.1 L/yr`). Always take the
   band matching the candidate's years, not the page headline (headline blends
   all experience).
   - Fresh individual reports (`N d ago · ₹ 63.0 L/yr · 10 years exp.`) appear
     near the top — quote as individual reports, never as the band.
   - The experience band required by the role (`8 - 16 years exp.`) sits on the
     index role card.
3. Locked content: city-level splits and per-report figures show a blur +
   "Unlock" — that is a paywall, not a bot block; don't attempt to defeat it,
   record India-wide bands and say the city split is paywalled.

## Caveats for recording

- Ladder mapping is the recorder's job: AmbitionBox role names are the
  employer's titles (e.g. MasterCard has no "Principal" page with samples) —
  never put a Lead-band figure on a Principal card as if it were that role's
  number; say the adjacent level in the note.
- Family mismatch (recording a Lead SWE band against a Lead Data Engineer req)
  goes in the `--note`, not in the low/high.

- Verified: 2026-10-14, MasterCard index + 3 role pages (lead-software-engineer,
  data-engineer, senior-soft-engineer), 8 figures recorded via `job pay`.
