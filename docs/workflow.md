# How Aja works — architecture & workflow

## The pattern

This repo is an **agent distro**, in the spirit of
[firstmate](https://github.com/kunchenguid/firstmate): the repo *is* the agent.
Open any AI CLI harness in this directory and it reads `AGENTS.md` and becomes
Aja. All judgment, reading, and writing belongs to the harness's model; all
bookkeeping belongs to `bin/applymate.ts`, a deterministic, dependency-free toolbelt.
State is files on disk, so any harness, any session, picks up where the last
stopped.

The chat/review UI borrows the [lavish-axi](https://github.com/kunchenguid/lavish-axi)
model: a local server shows artifacts as reviewable HTML with a chat panel; the
agent fetches the human's queued messages by polling the CLI. HTML is the new
markdown — tailored resumes are reviewed in the browser, not the terminal.

```
 candidate ──chat──► UI (127.0.0.1) ──queue──► workspace/chat/log.jsonl
    │                                             ▲
    │ reviews artifacts (HTML)                    │ chat poll / reply (CLI)
    ▼                                             │
 harness (Claude Code / Codex / Cursor / ZCode / Gemini / Antigravity)
    │  reads AGENTS.md → becomes Aja
    ▼
 bin/applymate.ts ── services ── adapters ── workspace/ (jobs, applications, profile, dossier index)
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
  jobs/<jobId>.json              postings (description, url, capture date, match score, evidence[])
  jobs/<jobId>/match.{json,md}   score reports
  jobs/<jobId>/evidence/         proof of what the posting said (jd-screenshot, jd-snapshot)
  applications/<appId>.json      pipeline state + history + submission facts + evidence[]
  applications/<appId>/resume.md cover-letter.md notes.md
  applications/<appId>/evidence/ proof of the submission (submit-screenshot, confirmation)
  profile/preferences.json       the candidate's standing decisions
  profile/answers.json           form-question memory (browser autofill)
  chat/log.jsonl                 the conversation queue (1 JSON message per line)
  dossier/index.json             indexed dossier (keywords, sections, kinds)
applymate.config.json                  settings (dossierDir, minMatchScore, ...)
```

Writes are atomic (temp + rename). The chat log tolerates a torn trailing line.

**Evidence trail.** Before applying, a job carries the full JD text, the
posting URL, the capture date (`addedAt`), and file captures filed by the
toolbelt as `workspace/jobs/<id>/evidence/<timestamp>-<kind>-<id>.<ext>` — at
minimum a `jd-screenshot` of the posting. After submitting, the application
carries a `submit-screenshot` of the confirmation page plus the exact
submission time, portal and confirmation number (`app submitted`). Each
evidence entry is structured ({kind, path, at, url, note}) and rendered as a
viewable link on the application card in the review UI (images served
natively). The trail answers, months later: what did the posting say, when did
we see it, what exactly did we submit, and when.

## The loops

**Relevance gate.** `job match` scores a JD against the dossier index
(frequency-weighted keyword coverage, 0–100, graded strong/good/fair/stretch).
`app start` refuses below `config minMatchScore` unless forced — the candidate's
"only relevant jobs" rule, enforced by the toolbelt rather than by memory.

**Ask & remember.** Before asking, the agent searches `answers` (exact
normalized-key match, then term-overlap ≥ 0.6). After the candidate answers, it
persists immediately. Preferences work the same way: `prefs missing` is the
session-start prompt; values are stored with source and timestamp, never
hardcoded in the repo.

**Browser autofill.** The browser is the default channel for both discovery
(browsing job boards and career pages via the harness's browser tools) and
applications. The harness's browser tools drive the page; the repo supplies
the data plane (`answers`), the guardrails (prime directives: no guessing
identity/legal fields, no submit without the candidate), and the audit trail
(notes.md, status history).

**Human-paced, never evasive.** Aja acts in the browser the way the candidate
would: one unhurried session per site, pages read before acting, natural
pauses, human typing rhythm, human-scale volume. That is what keeps accounts
in good standing. The hard line: CAPTCHAs and human-verification challenges
are handed to the candidate, and there is no fingerprint spoofing, stealth
tooling, or anti-bot evasion of any kind — a site that rejects automation gets
handed back to the candidate, not hidden from.

**Chat queue.** `workspace/chat/log.jsonl` is a single JSONL file; ids are
1-based line numbers. Consumers track their own `--since` cursor, so there is
no daemon state to lose.

## Safety

- The UI binds to 127.0.0.1 only; artifact routes are sandboxed to `workspace/`
  (path traversal returns 403).
- The markdown renderer escapes before parsing — artifacts can't inject HTML.
- Submission is a human act. The toolbelt's status machine gates `ready` on a
  resume artifact; only the candidate says "submit".
- No detection-evasion: the browser contract (`AGENTS.md` → "Act like a careful
  human in the browser") bans stealth tooling and challenge bypass outright.
