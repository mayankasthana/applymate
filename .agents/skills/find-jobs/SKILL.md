---
name: find-jobs
description: Find job postings relevant to the candidate's dossier and preferences, score them, and present a shortlist for approval.
---

# Find relevant jobs

1. Load the candidate's filters: `node bin/applymate.ts prefs list`. If `companyType`,
   `salaryFloor`, `workMode`, `locations`, or `seniority` are missing, ask
   before searching. Respect them strictly — e.g. skip service-based shops when
   the candidate prefers product-based companies.
2. **Discover in the browser when the harness has one.** Before browsing a
   site, read its recipe in `docs/portal-recipes/` (AGENTS.md "Browser
   recipes" rule) — and when a browsing difficulty gets solved, write the
   recipe back there and commit. Search job boards and
   company career pages with the browser tools: official search boxes and
   filters, unhurried, page by page — never bulk scraping or parallel crawls.
   Capture each promising JD's full text. Without browser tools, work from
   postings you are given. For each: `node bin/applymate.ts job add --company ... --title ... --file jd.md --url <posting url>`.
3. **Evidence before moving on** — postings vanish: screenshot the posting page
   (harness browser tools save PNG) and file it:
   `node bin/applymate.ts job evidence <jobId> shot.png --kind jd-screenshot --url <posting url>`.
   For tricky pages also save print-to-PDF/HTML with `--kind jd-snapshot`.
4. Score every posting: `node bin/applymate.ts job match <jobId>`. The toolbelt
   refuses applications below `config minMatchScore`; report the gate, do not
   route around it.
5. Shortlist in chat (`chat reply`): company — title — score/grade — one-line
   "why it fits" — notable missing skills. Let the candidate choose; only then
   run `node bin/applymate.ts app start <jobId>`.

$ARGUMENTS
