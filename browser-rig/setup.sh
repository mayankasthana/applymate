#!/usr/bin/env bash
# One-time setup for the laya browser rig: jev-ultrafast + the laya patch + our guard
# patch + a Python venv. Idempotent — safe to re-run. Model weights come separately
# via download-models.sh. See README.md.
set -euo pipefail
cd "$(dirname "$0")"

if ! command -v uv >/dev/null; then
  echo "error: uv is required (https://docs.astral.sh/uv/). Install: brew install uv" >&2
  exit 1
fi

# 1. jev-ultrafast (MIT) — the decision-loop client
if [ ! -d jev-ultrafast/.git ]; then
  git clone --depth 1 https://github.com/browser-use/jev-ultrafast jev-ultrafast
fi

# 2. laya's patch (vendored from cklxx/laya-browser, Apache-2.0): TYPESAFE_BASE_URL +
#    TEXT_MODEL_* support so the loop talks to a local decision server.
applied() { git -C jev-ultrafast apply --reverse --check "$1" >/dev/null 2>&1; }
if applied laya-browser.patch; then echo "[ok] laya-browser.patch already applied";
else git -C jev-ultrafast apply laya-browser.patch; echo "[ok] applied laya-browser.patch"; fi

# 3. our guard patch: task-spec guardrails hooked into choose() + per-choice failure counts
if applied guard.patch; then echo "[ok] guard.patch already applied";
else git -C jev-ultrafast apply guard.patch; echo "[ok] applied guard.patch"; fi

# 4. the guard module itself (pure stdlib, unit-tested in tests/)
cp guard.py jev-ultrafast/jev_ultrafast/guard.py
echo "[ok] installed jev_ultrafast/guard.py"

# 5. Python environment (3.12: laya needs <3.13, jev needs >=3.12)
if [ ! -x .venv/bin/python ]; then
  uv venv --python 3.12 .venv
  uv pip install --python .venv/bin/python \
    laya torch transformers huggingface_hub "httpx[http2]" browser-harness==0.1.13 numpy
  echo "[ok] created .venv"
else
  echo "[ok] .venv exists"
fi

cat <<'EOF'

Done. Next:
  ./download-models.sh                                   # ~644MB model weights
  .venv/bin/python tests/test_guard.py -v                # guard unit tests (no services needed)
Then run the three services + a suite — see README.md.
EOF
