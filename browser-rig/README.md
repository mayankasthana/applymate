# browser-rig — local laya form-filling rig

Fast, local, API-free form filling for job applications. `cklxx/laya-browser` v17s (a
322M non-autoregressive decision head, Apache-2.0) drives headless Chrome through
`browser-use/jev-ultrafast` (MIT), replacing the paid TypeSafe Jev API with a local
server. On an M1 Pro it decides in ~410ms/step; full application-style forms fill and
submit in 5–7 seconds end-to-end.

The raw model had two measured failure modes on long forms — premature DONE and stray
PRESS_ENTER — fixed here with deterministic, spec-driven guardrails (no retraining):
DONE is locked until the success text is visible (submit mode) or every mapped field
holds its value (stage mode); Enter, site nav, ads, and dead fields are removed from the
choices; satisfied fields can't be re-typed; checkbox/radio clicks are restricted to the
spec's required toggles.

## Layout

| path | what it is |
|---|---|
| `guard.py` | the guardrails — pure stdlib, unit-tested, copied into the jev package by `setup.sh` |
| `patches/guard.patch` | our diff vs the laya-patched jev (import + call site + failure counting) |
| `laya-browser.patch` | vendored from cklxx/laya-browser (Apache-2.0): `TYPESAFE_BASE_URL` / `TEXT_MODEL_*` support |
| `spec_server.py` | port 30000: active task spec (`/spec`) + TYPE_TEXT field values (`/v1/chat/completions`) |
| `suites/` | benchmark suites: our career-site suite, the author's Suite A re-run, verbose single-task runner |
| `setup.sh` / `download-models.sh` | idempotent setup (clone + patch + venv) and the ~644MB checkpoint |
| `tests/` | stdlib unittest suite — also runs under `npm run test:rig` |

Gitignored at runtime: `jev-ultrafast/` (the patched clone), `.venv/`, `models/`.

## Setup

```bash
./setup.sh            # clones + patches jev-ultrafast, installs .venv (uv, python 3.12)
./download-models.sh  # the v17s checkpoint into models/laya-browser/v17s
python3 -m unittest discover -s tests   # guard + spec server tests (no services needed)
```

## Run

Three services, then a suite:

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new \
  --remote-debugging-port=9222 --user-data-dir=/tmp/laya-chrome-profile about:blank &
cd jev-ultrafast && LAYA_FAST=0 ../.venv/bin/python \
  ../laya-browser-code/systemone_server.py 8791 ../models/laya-browser/v17s 12 &   # see note
.venv/bin/python spec_server.py &                # port 30000
.venv/bin/python suites/career_suite.py          # 4 career tasks, 2 repeats via REPEATS=2
```

> The decision server (`systemone_server.py`) ships in the cklxx/laya-browser repo —
> point it at your local clone of that repo (`laya-browser-code` above). `applymate rig
> check` verifies all three services are up.

Applymate integration: `applymate rig spec --name <app>` builds the task spec from the
candidate's stored answers (`src/form-spec.ts`) into `workspace/rig/`; run the spec
server with `--specs workspace/rig/<name>.spec.json` and the guardrails + typed values
come from the candidate's own answers — nothing invented, nothing submitted without the
candidate's explicit yes.

## Results (2026-09-28, REPEATS=2)

| task | result | wall |
|---|---|---|
| formy application form (fill + submit) | PASS 2/2 | 4.5–5.1s |
| demoqa practice form (5 fields + radio + checkbox + submit) | PASS 2/2 | 6.8–7.2s |
| Lever board → specific posting | PASS 2/2 | ~10s |
| Greenhouse board → specific posting | FAIL 0/2 | ~5s |

Decision latency (guarded): median 410ms, mean 435ms, p90 562ms (861 decisions).
The Greenhouse failure is target *grounding* in the model (near-miss titles), not
guardable — Applymate therefore opens application form URLs directly instead of
navigating boards with the rig.

## Known limits

- Unlabeled radios ("Radio button") are unidentifiable from the DOM table — keep them
  out of the spec or surface them to the candidate.
- jev's DOM reader hides password fields by design, so logins are impossible.
- Sites that block headless Chromium can't be used at all.
- Waiting on a TypeSafe API key: when it arrives, the same rig benchmarks hosted Jev by
  pointing `TYPESAFE_BASE_URL` at the default and setting the key.
