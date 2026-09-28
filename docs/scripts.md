# The applymate toolbelt — command reference

Every command: `node bin/applymate.ts <command> [args] [--json]`. Add `--json` for
machine-readable output. Run from the repo root so `applymate.config.json` and
`workspace/` resolve.

## Setup

| command | what it does |
|---|---|
| `init` | Scaffold `applymate.config.json` + `workspace/` directories (idempotent) |
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
| `dossier files [--kind kind] [--role role]` | List indexed files by kind and/or role |

**Match vocabulary (profile vs reference).** Every indexed file gets a `role`:
`profile` (resumes, work history, project docs — evidence of real experience)
or `reference` (interview prep, chat/email archives, raw notes, cover letters
written for other companies). `job match` scores the JD only against terms from
profile files, and that vocabulary is effectively uncapped, so common-but-real
terms ("systems", "scale") are never dropped the way a top-200 cap drops them.
The heuristic classifies by path; override it per file with the config keys
`dossierProfileGlobs` / `dossierReferenceGlobs` (glob patterns on the
dossier-relative path, `*` wildcard; profile wins). Inspect the split with
`dossier files --role reference`. Re-run `dossier index` after changing roles.
Profile globs win over reference globs, so whitelist mode works: set
`dossierReferenceGlobs` to `["*"]` and re-include only your core docs via
`dossierProfileGlobs`.

## Preferences (candidate decisions — never hardcoded)

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
| `job add --company C --title T [--url U] [--file jd.md \| --desc text] [--location L]` | Track a posting (JD text, URL and capture date stored on the record) |
| `job evidence <jobId> <file> --kind jd-screenshot [--url U] [--note n] [--at iso]` | Copy a capture into `workspace/jobs/<id>/evidence/` and record it (png/jpg/webp/gif/pdf/html/txt/md) |
| `job list` / `job show <id>` | List / inspect (show prints the evidence list) |
| `job match <jobId>` | Score the JD against the dossier; persists score + writes `workspace/jobs/<id>/match.{json,md}` |
| `app start <jobId> [--resume path] [--force]` | Open an application. Relevance gate: refuses below `minMatchScore` unless `--force` |
| `app list [--status s]` / `app show <id>` | List / inspect with history, submission details and evidence |
| `app move <id> <status> [--note n]` | Walk the status machine (illegal skips rejected) |
| `app artifact <id> <resume\|coverLetter\|notes> <path>` | Register a workspace-relative artifact |
| `app evidence <appId> <file> --kind submit-screenshot [--note n] [--at iso]` | Store submit-page screenshots and confirmations |
| `app submitted <appId> [--portal p] [--confirmation c] [--at iso]` | Stamp exact submission time + portal + confirmation; walks the machine to `submitted` |
| `app match <appId>` | Score + attach report to the application |
| `pipeline` | Kanban view across all statuses |

**Evidence kinds** are slugs; conventions: `jd-screenshot`, `jd-snapshot`
(saved page/PDF) on jobs; `submit-screenshot`, `confirmation` on applications.
Every entry records its kind, ISO timestamp, source URL (jobs), and note.
`app submitted` refuses illegal status jumps — `discovered → submitted` is not
a thing; walk the machine first.

Status machine: `discovered → matched → tailoring → ready → submitted →
interviewing → offer`; `closed` from any non-terminal; `rejected` from
submitted/interviewing. `ready` requires a resume artifact. Nothing moves to
`submitted` except by the candidate's instruction.

## Chat

| command | what it does |
|---|---|
| `chat send <text...>` | Candidate sends a message (UI does this too) |
| `chat reply <text...>` | Agent posts a reply |
| `chat poll [--since n] [--wait seconds]` | Fetch new *user* messages; long-polls up to `wait` |
| `chat log [--since n]` | Full transcript |
| `chat serve [--port p]` | Local chat/review UI (loopback only) |

## Browser rig (local laya form-filling rig)

| command | what it does |
|---|---|
| `rig spec [--name n] [--submit --success-text re] [--out f]` | Build a task spec for `browser-rig/spec_server.py` from the stored answers + `candidateName` pref. Default mode `stage`: DONE unlocks when every mapped field visibly holds its value (fill, never submit). `--submit` unlocks DONE on the success text instead — only for forms the candidate explicitly approved. Writes `workspace/rig/<name>.spec.json` (personal data — never committed) |
| `rig check [--cdp u] [--decision u] [--spec u]` | Probe the rig's three services (headless Chrome CDP :9222, laya decision server :8791, spec server :30000); exit 1 if any is down |

The rig itself lives in `browser-rig/` (setup, guardrails, benchmarks, tests) — see
`browser-rig/README.md`.

## Artifacts

| command | what it does |
|---|---|
| `render <file.md> [--out f.html] [--title t]` | Markdown → standalone HTML page (escape-first, XSS-safe subset) |

## For contributors

Tests: `npm test` (node:test, 120+ tests). Types: `npm run typecheck`
(tsc --strict, no emit — TypeScript runs natively via Node 24 type-stripping;
zero runtime dependencies). architecture notes in `docs/workflow.md`.
