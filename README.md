# Applymate

> **Aja** — your job-application first mate. Talk to one agent. Land the role.

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
  already knows. Nothing about you is hardcoded in the repo.
- **Browser-ready.** With a harness that has browser/computer-use tools, Aja
  fills portals and clicks through Next buttons using your stored answers —
  and stops at the final Submit for your explicit yes. Always.
- **Private by default.** Dossier, pipeline, and memory live under
  `workspace/` (gitignored); the UI binds to loopback; nothing is submitted or
  sent anywhere without you.
- **Zero runtime dependencies.** TypeScript on Node ≥ 24 native type-stripping.
  `npm test` (134 node:test tests), `npm run typecheck` (tsc strict).

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

## License

MIT — see [LICENSE](LICENSE).
