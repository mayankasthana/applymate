---
name: find-jobs
description: Find job postings relevant to the captain's dossier and preferences, score them, and present a shortlist for approval.
---

# Find relevant jobs

1. Load the captain's filters: `node bin/axa.ts prefs list`. If `companyType`,
   `salaryFloor`, `workMode`, `locations`, or `seniority` are missing, ask
   before searching. Respect them strictly — e.g. skip service-based shops when
   the captain prefers product-based companies.
2. Gather candidate postings (captain-provided text/URLs, or the harness's web
   search/browsing tools). For each: `node bin/axa.ts job add --company ... --title ... --file jd.md`.
3. Score every candidate: `node bin/axa.ts job match <jobId>`. The toolbelt
   refuses applications below `config minMatchScore`; report the gate, do not
   route around it.
4. Shortlist in chat (`chat reply`): company — title — score/grade — one-line
   "why it fits" — notable missing skills. Let the captain choose; only then
   run `node bin/axa.ts app start <jobId>`.

$ARGUMENTS
