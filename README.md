# applyjobagent

> **Aja** — your job-application first mate. Talk to one agent. Land the role.

A harness-agnostic **agent distro** for the job-application workflow, in the spirit of
[firstmate](https://github.com/kunchenguid/firstmate): the repo *is* the agent. Open any
AI CLI harness (Claude Code, Codex, Cursor, ZCode, Gemini CLI, Antigravity, ...) in this
directory and it reads `AGENTS.md` and becomes Aja — a job-hunting first mate that turns
your resume dossier into tailored, tracked applications.

Deterministic bookkeeping lives in `bin/axa.mjs`, a zero-dependency Node toolbelt
(the "AXI" pattern from [lavish-axi](https://github.com/kunchenguid/lavish-axi)):
dossier indexing, match scoring, application pipeline, and a local chat/review UI
the agent polls — HTML is the new markdown, so you review tailored resumes in the
browser and send feedback straight back to the agent.

- **No runtime dependencies.** Node ≥ 20 built-ins only.
- **State on disk.** Everything is files under `workspace/`; restart any time, any harness picks up where the last left off.
- **Test-driven.** `npm test` runs the `node:test` suite.
- **Private by default.** Your dossier and pipeline never leave your machine; nothing is submitted anywhere without you.

## Quick start

```bash
git clone https://github.com/mayankasthana/applyjobagent
cd applyjobagent
claude            # or: codex, cursor-agent, zcode, gemini, antigravity, ...
```

Then talk to Aja:

> "Point yourself at my dossier at ~/Docs/resume-dossier and add this job posting: <paste>"

```bash
npm test          # run the test suite
node bin/axa.mjs --help
```

Full docs: [`docs/scripts.md`](docs/scripts.md) (toolbelt reference),
[`docs/workflow.md`](docs/workflow.md) (the application pipeline),
[`AGENTS.md`](AGENTS.md) (the agent contract).

## License

MIT — see [LICENSE](LICENSE).
