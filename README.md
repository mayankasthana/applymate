# Applymate

> **Aja** — your job-application first mate. Talk to one agent. Land the role.

[![CI](https://github.com/mayankasthana/applymate/actions/workflows/ci.yml/badge.svg)](https://github.com/mayankasthana/applymate/actions/workflows/ci.yml)

A harness-agnostic **agent distro** for the job-application workflow, in the
spirit of [firstmate](https://github.com/kunchenguid/firstmate): the repo *is*
the agent. Open any AI CLI harness in this directory and it reads `AGENTS.md`
and becomes Aja — turning your resume dossier into relevant, tailored, tracked
applications, with you in the loop.

Deterministic bookkeeping lives in `bin/applymate.ts`, a zero-runtime-dependency
Node toolbelt (the "AXI" pattern from
[lavish-axi](https://github.com/kunchenguid/lavish-axi)): dossier indexing,
match scoring, an application pipeline, and a local chat/review UI the agent
polls. Tailored resumes render as HTML you review in the browser; your feedback
flows back through chat.

- **Works in your harness.** Claude Code, Codex, Cursor, ZCode, Gemini CLI,
  Antigravity — anything that reads `AGENTS.md`. (`CLAUDE.md`/`GEMINI.md` are
  pointer files.)
- **Only relevant jobs.** Job descriptions are scored against your dossier; the
  toolbelt refuses applications below your `minMatchScore` floor (default 60).
- **Ask & remember.** The agent asks you about missing preferences (product vs
  service companies, salary floor, ...) and every form question it can't
  answer — then stores both in `workspace/profile/` so the next session
  already knows. Nothing about you is hardcoded in the repo: even the rules for
  your resume live in a `profile note` the repo only points at.
- **Learns from your judgment, not from optimism.** `applymate learn` compares
  the match score against the pursuit verdicts you actually recorded and the
  outcomes you actually got — reporting where the score predicts your calls and
  where it overlaps. It is advisory: it never moves your relevance floor, and it
  says "not enough data" when that is the truth.
- **Browser-ready.** With a harness that has browser/computer-use tools, Aja
  fills portals and clicks through Next buttons using your stored answers —
  and stops at the final Submit for your explicit yes. Always.
- **Private by default.** Dossier, pipeline, and memory live under
  `workspace/` (gitignored); the UI binds to loopback; nothing is submitted or
  sent anywhere without you. A test suite enforces it — the build fails if
  workspace state, a home-directory path, or a real email is ever committed.
- **Zero runtime dependencies.** TypeScript on Node ≥ 24 native type-stripping.
  `npm test` (219 node:test tests), `npm run typecheck` (tsc strict).

## Quick start

```bash
git clone https://github.com/mayankasthana/applymate
cd applymate
claude            # or: codex, cursor-agent, zcode, gemini, antigravity, ...
```

Then talk to Aja:

> "Point yourself at my dossier at ~/Docs/resume-dossier, then find me
> product-based backend roles."

First run (or let Aja do it):

```bash
npm run applymate -- init
npm run applymate -- config set dossierDir ~/Docs/resume-dossier
npm run applymate -- dossier index
npm run applymate -- chat serve        # http://127.0.0.1:4388 — pipeline + chat
```

Full docs: [`docs/scripts.md`](docs/scripts.md) (toolbelt reference),
[`docs/workflow.md`](docs/workflow.md) (architecture & loops),
[`AGENTS.md`](AGENTS.md) (the agent contract).

## Responsible use

Applymate automates actions a candidate could take themselves, and it is built
to stay on the right side of that line:

- **Submission is human-gated.** The agent never clicks a final Submit without
  the candidate's explicit, per-application confirmation — the status machine
  and the agent contract (`AGENTS.md`) enforce it.
- **No CAPTCHA or anti-bot evasion, ever.** Verification challenges are handed
  back to the candidate. There is no fingerprint spoofing, stealth tooling, or
  proxy trickery in this repo; PRs adding any will be declined.
- **Human pacing is built in.** One unhurried session per site, natural
  pauses, human typing rhythm, human-scale volume — see "Act like a careful
  human in the browser" in [`AGENTS.md`](AGENTS.md).
- **You own compliance and accuracy.** You are responsible for following the
  terms of service of every job board or portal you point Applymate at, and
  for the truthfulness of everything it helps you submit.

## License

MIT — see [LICENSE](LICENSE).
