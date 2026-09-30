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
   The resume must not contain the target company's name or the target role's
   title anywhere — no header, objective, summary, or body line. Naming them
   makes the resume look customized for the posting; tailor the content, keep
   the document generic. (The candidate's own past employers and titles stay.
   The cover letter is where company and role belong.) Before registering,
   run both documents through the `humanizer` skill —
   every word that goes out in the candidate's name must pass it (prime
   directive 6 in AGENTS.md). It strips AI tells so the documents read like
   the candidate wrote them; facts and claims stay untouched.
4. Apply the candidate-mandated resume standards (full text in AGENTS.md,
   "Resume standards"):
   - One title per line — each position is company line, title alone, date
     range alone. Never join titles/dates on one line (ATS).
   - GenAI/agentic content always in: the candidate's lab work section, a
     hackathon RAG win, summary clause, LangChain/RAG + agentic breadth
     keywords. Engineering framing only; no returns/strategy/P&L, no
     ML-modeling claims.
   - The standing open-source list is candidate-specific and lives in the
     workspace note `resume-standards`, not in this file.
   - Ship as a 2-page A4 PDF: the stock `render` HTML has no print CSS — apply
     a print stylesheet and verify the page count before showing the PDF.
   - Upload/submit under a generic filename (`Resume.pdf`) —
     never the target company/role in the filename; recruiters see it.
     Per-company names are for the private dossier copies only.
5. Register artifacts:
   - `node bin/applymate.ts app artifact <id> resume applications/<id>/resume.md`
   - `node bin/applymate.ts app artifact <id> coverLetter applications/<id>/cover-letter.md`
6. `node bin/applymate.ts render` each artifact; ensure the review UI is running
   (`chat serve`) and tell the candidate what to review and where. **Portal
   form work does not start until the candidate has reviewed these artifacts** —
   "apply to X" authorizes the tailoring, not a bypass of the review.
7. Move status as work completes: `matched → tailoring → ready`. `ready`
   requires the resume artifact (toolbelt-enforced). Submission waits for the
   candidate's explicit go — always.

$ARGUMENTS
