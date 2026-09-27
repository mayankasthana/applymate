# How Aja works — architecture & workflow

## The pattern

This repo is an **agent distro**, in the spirit of
[firstmate](https://github.com/kunchenguid/firstmate): the repo *is* the agent.
Open any AI CLI harness in this directory and it reads `AGENTS.md` and becomes
Aja. All judgment, reading, and writing belongs to the harness's model; all
bookkeeping belongs to `bin/axa.ts`, a deterministic, dependency-free toolbelt.
State is files on disk, so any harness, any session, picks up where the last
stopped.

The chat/review UI borrows the [lavish-axi](https://github.com/kunchenguid/lavish-axi)
model: a local server shows artifacts as reviewable HTML with a chat panel; the
agent fetches the human's queued messages by polling the CLI. HTML is the new
markdown — tailored resumes are reviewed in the browser, not the terminal.

```
 captain ──chat──► UI (127.0.0.1) ──queue──► workspace/chat/log.jsonl
    │                                             ▲
    │ reviews artifacts (HTML)                    │ chat poll / reply (CLI)
    ▼                                             │
 harness (Claude Code / Codex / Cursor / ZCode / Gemini / Antigravity)
    │  reads AGENTS.md → becomes Aja
    ▼
 bin/axa.ts ── services ── adapters ── workspace/ (jobs, applications, profile, dossier index)
    ▲
 dossier dir (your resumes — referenced by config, never copied into the repo)
```

## Layering (SOLID)

```
src/
  domain.ts               entities + status machine (pure, no I/O)
  services/               orchestration: pipeline, dossier, matcher, profile, inbox, markdown
  adapters/json-collection.ts   Collection<T> port over atomic JSON files
  workspace.ts            composition root: wires adapters into services from config
  cli.ts                  command registry (longest-prefix lookup, --json)
  server.ts + server-ui.ts  local chat/review UI (loopback, sandboxed paths)
```

- **DIP**: `PipelineService` takes `Collection<T>` ports; nothing above knows
  about the filesystem.
- **OCP**: CLI commands are registry entries; a new command is a new entry.
- **ISP**: small ports (`Collection`, `DossierSearcher`, `Io`).
- **SRP**: one service per concern; the matcher only scores, the inbox only
  queues, the profile store only remembers.

## Data layout (all personal state is gitignored)

```
workspace/
  jobs/<jobId>.json              postings (description, match score)
  jobs/<jobId>/match.{json,md}   score reports
  applications/<appId>.json      pipeline state + history + artifact refs
  applications/<appId>/resume.md cover-letter.md notes.md
  profile/preferences.json       the captain's standing decisions
  profile/answers.json           form-question memory (browser autofill)
  chat/log.jsonl                 the conversation queue (1 JSON message per line)
  dossier/index.json             indexed dossier (keywords, sections, kinds)
axa.config.json                  settings (dossierDir, minMatchScore, ...)
```

Writes are atomic (temp + rename). The chat log tolerates a torn trailing line.

## The loops

**Relevance gate.** `job match` scores a JD against the dossier index
(frequency-weighted keyword coverage, 0–100, graded strong/good/fair/stretch).
`app start` refuses below `config minMatchScore` unless forced — the captain's
"only relevant jobs" rule, enforced by the toolbelt rather than by memory.

**Ask & remember.** Before asking, the agent searches `answers` (exact
normalized-key match, then term-overlap ≥ 0.6). After the captain answers, it
persists immediately. Preferences work the same way: `prefs missing` is the
session-start prompt; values are stored with source and timestamp, never
hardcoded in the repo.

**Browser autofill.** The harness's browser tools drive the portal; the repo
supplies the data plane (`answers`), the guardrails (prime directives: no
guessing identity/legal fields, no submit without the captain), and the audit
trail (notes.md, status history).

**Chat queue.** `workspace/chat/log.jsonl` is a single JSONL file; ids are
1-based line numbers. Consumers track their own `--since` cursor, so there is
no daemon state to lose.

## Safety

- The UI binds to 127.0.0.1 only; artifact routes are sandboxed to `workspace/`
  (path traversal returns 403).
- The markdown renderer escapes before parsing — artifacts can't inject HTML.
- Submission is a human act. The toolbelt's status machine gates `ready` on a
  resume artifact; only the captain says "submit".
