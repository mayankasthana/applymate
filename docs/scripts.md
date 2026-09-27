# The axa toolbelt — command reference

Every command: `node bin/axa.ts <command> [args] [--json]`. Add `--json` for
machine-readable output. Run from the repo root so `axa.config.json` and
`workspace/` resolve.

## Setup

| command | what it does |
|---|---|
| `init` | Scaffold `axa.config.json` + `workspace/` directories (idempotent) |
| `config get [key]` | Print one or all settings |
| `config set <key> <value>` | Update a setting (validated, atomic write) |

Settings: `dossierDir` (path to your resume dossier — supports `~/`),
`workspaceDir` (default `workspace`), `autonomy` (`draft` \| `assist` —
drafting help only; submission is always human-gated), `chatPort` (default
4388), `minMatchScore` (relevance floor, default 60).

## Dossier

| command | what it does |
|---|---|
| `dossier index [--dir path]` | Walk the dossier (md/txt), classify files (master-resume, resume, skills, background, cover-letter), extract keywords, write `workspace/dossier/index.json` |
| `dossier search <query...>` | Rank dossier files against free text |
| `dossier files [--kind kind]` | List indexed files by kind |

## Preferences (captain decisions — never hardcoded)

| command | what it does |
|---|---|
| `prefs list` | All stored preferences with source + timestamp |
| `prefs get <key>` | One preference (exit 1 if unset) |
| `prefs set <key> <value> [--source chat\|user\|inferred]` | Store a decision |
| `prefs missing` | Recommended keys with no value yet — what to ask about |

Recommended keys (suggestions only, values always yours):
`companyType`, `salaryFloor`, `workMode`, `locations`, `seniority`.

## Answers (application-form memory)

| command | what it does |
|---|---|
| `answers set <question> <answer>` | Remember a Q/A pair (upsert; questions are key-normalized) |
| `answers get <question...>` | Best matching answer — exact key match first, then term-overlap ≥ 0.6 |
| `answers list` | Dump everything (what the browser-fill protocol reads first) |

## Pipeline

| command | what it does |
|---|---|
| `job add --company C --title T [--file jd.md \| --desc text] [--url U] [--location L]` | Track a posting |
| `job list` / `job show <id>` | List / inspect |
| `job match <jobId>` | Score the JD against the dossier; persists score + writes `workspace/jobs/<id>/match.{json,md}` |
| `app start <jobId> [--resume path] [--force]` | Open an application. Relevance gate: refuses below `minMatchScore` unless `--force` |
| `app list [--status s]` / `app show <id>` | List / inspect with history |
| `app move <id> <status> [--note n]` | Walk the status machine (illegal skips rejected) |
| `app artifact <id> <resume\|coverLetter\|notes> <path>` | Register a workspace-relative artifact |
| `app match <appId>` | Score + attach report to the application |
| `pipeline` | Kanban view across all statuses |

Status machine: `discovered → matched → tailoring → ready → submitted →
interviewing → offer`; `closed` from any non-terminal; `rejected` from
submitted/interviewing. `ready` requires a resume artifact. Nothing moves to
`submitted` except by the captain's instruction.

## Chat

| command | what it does |
|---|---|
| `chat send <text...>` | Captain sends a message (UI does this too) |
| `chat reply <text...>` | Agent posts a reply |
| `chat poll [--since n] [--wait seconds]` | Fetch new *user* messages; long-polls up to `wait` |
| `chat log [--since n]` | Full transcript |
| `chat serve [--port p]` | Local chat/review UI (loopback only) |

## Artifacts

| command | what it does |
|---|---|
| `render <file.md> [--out f.html] [--title t]` | Markdown → standalone HTML page (escape-first, XSS-safe subset) |

## For contributors

Tests: `npm test` (node:test, 120+ tests). Types: `npm run typecheck`
(tsc --strict, no emit — TypeScript runs natively via Node 24 type-stripping;
zero runtime dependencies). architecture notes in `docs/workflow.md`.
