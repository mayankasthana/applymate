---
name: find-jobs
description: Find job postings relevant to the candidate's dossier and preferences, score them, and present a shortlist for approval.
---

# Find relevant jobs

1. Load the candidate's filters: `node bin/axa.ts prefs list`. If `companyType`,
   `salaryFloor`, `workMode`, `locations`, or `seniority` are missing, ask
   before searching. Respect them strictly — e.g. skip service-based shops when
   the candidate prefers product-based companies.
2. **Discover in the browser when the harness has one.** Search job boards and
   company career pages with the browser tools: official search boxes and
   filters, unhurried, page by page — never bulk scraping or parallel crawls.
   Capture each promising JD's full text. Without browser tools, work from
   postings you are given. For each: `node bin/axa.ts job add --company ... --title ... --file jd.md`.
3. Score every posting: `node bin/axa.ts job match <jobId>`. The toolbelt
   refuses applications below `config minMatchScore`; report the gate, do not
   route around it.
4. Shortlist in chat (`chat reply`): company — title — score/grade — one-line
   "why it fits" — notable missing skills. Let the candidate choose; only then
   run `node bin/axa.ts app start <jobId>`.

$ARGUMENTS
