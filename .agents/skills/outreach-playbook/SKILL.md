---
name: outreach-playbook
description: Draft LinkedIn outreach (hiring managers, recruiters, referrers) from the candidate's message playbook, gate every send on approval, and track sends/follow-ups with the toolbelt.
---

# Outreach messages (the playbook)

The candidate's formula bank lives at `workspace/profile/outreach-playbook.md`
(families A–F with the exact templates). Read it before drafting. If it is
missing, ask the candidate for it; draft from the matrix below meanwhile and
save the result there. It is personal data (`workspace/` is gitignored) — never
commit it, never paste it into logs or third-party services.

**Author-facts guard.** The playbook was supplied by the candidate but written
for someone else: its filled-in proof points and sign-off are the *original
author's examples*. Keep the formulas; fill every bracket and every quantified
claim from the candidate's own dossier (`dossier search`), `answers`, `prefs`,
and the job/app records. If the dossier doesn't support a number the template
wants, leave the bracket and ask — never copy the author's figures and never
invent. If the playbook genuinely belongs to the candidate, they'll say so; then
and only then may its numbers be used.

## The 6 rules (every message, every channel)

1. Under 100 words — long messages get skimmed and skipped.
2. Personalize the first line (their team, product, or a post). Generic = deleted.
3. Lead with value/fit, not a request. Never open with "Are you hiring?"
4. Anchor ONE concrete, quantified proof point — traceable to the dossier.
5. End with ONE low-friction ask (a 15-min chat, a pointer, a yes/no).
6. Replies refund InMail credits — target hard, and follow up once after 4–5 days (tracked; see below).

## Scam-aware drafting (India — every referral ask, invite, and follow-up)

Indian professionals are hyper-alert to job scams (fake recruiters, phishing,
"refer me" spam). Anything that pattern-matches a scam gets ignored or
reported — so every draft gets this check before the humanizer pass:

- **Never ask for "insider" anything.** No "insider read", "insider info",
  "what's it really like inside". The ask is a referral or a pointer, never
  information extraction — asking for confidential-sounding info makes the
  recipient uncomfortable and scam-alarmed.
- **Lead with the verifiable thread.** Name the real connection in line 1 —
  mutuals in common, ex-employer overlap, college — only what both LinkedIn
  profiles actually show. A checkable thread is the strongest "real person"
  signal; vague or faked familiarity is the strongest scam signal. Never
  invent or stretch a tie.
- **Name the exact req.** Role title (+ req ID when known) and location in
  the first or second line. "Roles at your company" reads as mass spam.
- **Give the referrer a forwardable fit line.** Level, years, stack, one
  quantified proof point — what they need to justify a referral in 10
  seconds.
- **The ask is a portal action, not a conversation.** "Would you be
  comfortable referring me? Happy to send my resume" — offer the resume
  yourself; never ask them to click off-platform links or send anything to
  an email address (that is phishing shape), and never ask for *their*
  details.
- **Plain register, zero pressure.** No urgency ("urgent", "ASAP"), no
  generic flattery, no "kindly", no exclamation stacks; one sincere out
  ("completely understand if not") and no follow-up nagging beyond the
  single tracked E-follow-up.

Scam-avoidance and conversion are the same move: specific, verifiable, easy
to act on, zero obligation.

## Pick the variant

| Situation | Variant |
|---|---|
| Open role → hiring manager | A1 (direct fit) |
| No open role, admire the team | A2 |
| They posted / spoke publicly | A3 |
| In-house recruiter, reach or reply | B1 |
| Cold outreach to an agency recruiter | B2 |
| One-line pitch inside a recruiter InMail reply | B3 |
| 2nd-degree connection at the target company | C1 |
| Former colleague at the target company | C2 |
| Ask someone in your network for an intro | C3 (include the 2-line blurb) |
| Connection request note — free, no InMail | D1 manager / D2 recruiter / D3 peer (≤ 300 chars — count them) |
| Follow-up, once, 4–5 days later | E1 gentle nudge / E2 new proof point |
| InMail subject line | F bank |

## Workflow

1. Read the playbook file, pick the variant, gather candidate facts (dossier,
   prefs, answers) and target facts (`job show` / `app show`, the person's
   profile or post — read it in the browser, don't guess it).
2. Draft into the application's `notes.md` artifact (or a scratch markdown file
   when outreach precedes an application). Check the caps: < 100 words for
   messages; connection notes ≤ 300 chars on free accounts, up to ~500 on paid
   plans — read prefs `linkedinplan` for the candidate's plan and verify the
   live counter in the compose UI (LinkedIn adjusts limits). One ask per
   message. Check every
   draft against the scam-aware rules above (especially: no "insider" asks).
   Then run
   every draft through the `humanizer` skill before it is shown: the playbook
   formulas are skeletons, and the humanizer pass strips the AI tells so the
   message reads like the candidate wrote it. Facts and numbers stay exactly
   as gathered in step 1.
3. **Show every draft and wait for an explicit yes** — nothing leaves the
   machine without it (prime directive 1). A few at a time, never bulk blasts;
   personalized per person, not template spam.
4. After the candidate approves and sends, log it so the follow-up rule survives
   the session:
   `node bin/applymate.ts outreach log --target "<name>" --role hiring-manager|recruiter|referrer --channel inmail|connection-note|dm|email --variant A1 [--app <appId>] [--company <co>] [--note "..."]`
5. Chase on schedule, not from memory: `node bin/applymate.ts outreach list --due`
   at the start of any outreach session. Send the E-variant follow-up ONCE on
   approval, then `outreach followup <id>`. When a reply lands, record it:
   `outreach replied <id>` — the toolbelt then stops listing it as due.

$ARGUMENTS
