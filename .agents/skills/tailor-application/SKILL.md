---
name: tailor-application
description: Tailor resume and cover letter for a tracked application from the dossier, register artifacts, and stage them for candidate review.
---

# Tailor an application

1. Ensure the job exists and is scored: `node bin/applymate.ts job match <jobId>`.
   If the relevance gate refuses, tell the candidate; proceed only with their
   explicit `--force`.
2. `node bin/applymate.ts app start <jobId>` — prefer `--resume <dossier path>` using
   the best suggestion from `job match` output (candidate keeps per-company
   resumes; fall back to the master resume).
3. Read the chosen resume plus supporting dossier docs (`dossier search`).
   Write `workspace/applications/<appId>/resume.md` and `cover-letter.md`,
   tailored to the JD with only dossier facts. Close obvious keyword gaps the
   dossier truly supports; list real gaps in `notes.md` instead of inventing.
4. Register artifacts:
   - `node bin/applymate.ts app artifact <id> resume applications/<id>/resume.md`
   - `node bin/applymate.ts app artifact <id> coverLetter applications/<id>/cover-letter.md`
5. `node bin/applymate.ts render` each artifact; ensure the review UI is running
   (`chat serve`) and tell the candidate what to review and where.
6. Move status as work completes: `matched → tailoring → ready`. `ready`
   requires the resume artifact (toolbelt-enforced). Submission waits for the
   candidate's explicit go — always.

$ARGUMENTS
