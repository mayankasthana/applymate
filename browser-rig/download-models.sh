#!/usr/bin/env bash
# Download the laya-browser v17s checkpoint (~644MB) into models/laya-browser/v17s.
# The repo is cloned without git-lfs; the small JSON files are fetched raw and the
# safetensors via the resolve endpoint. Idempotent.
set -euo pipefail
cd "$(dirname "$0")"

DEST=models/laya-browser
if [ -f "$DEST/v17s/model.safetensors" ]; then
  echo "[ok] weights already present at $DEST/v17s/model.safetensors"
  exit 0
fi
rm -rf "$DEST"
GIT_LFS_SKIP_SMUDGE=1 git clone --depth 1 https://huggingface.co/cklxx/laya-browser "$DEST"
cd "$DEST/v17s"
# small files: clone with LFS skipped leaves pointer stubs — fetch the real JSON
for f in tokenizer/tokenizer.json tokenizer/tokenizer_config.json encoder/config.json rl_agent_config.json; do
  curl -sL -o "$f" "https://huggingface.co/cklxx/laya-browser/resolve/main/v17s/$f"
done
echo "downloading model.safetensors (~644MB)..."
curl -sL -o model.safetensors "https://huggingface.co/cklxx/laya-browser/resolve/main/v17s/model.safetensors"
echo "[ok] checkpoint ready: $(pwd)"
