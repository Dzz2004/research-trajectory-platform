#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

TRAJECTORY_NODE_BIN="$(command -v node || true)"
if [ -z "$TRAJECTORY_NODE_BIN" ]; then
  for candidate in "$HOME"/.local/share/fnm/node-versions/*/installation/bin/node "$HOME"/.nvm/versions/node/*/bin/node; do
    if [ -x "$candidate" ]; then TRAJECTORY_NODE_BIN="$candidate"; fi
  done
fi
if [ -z "$TRAJECTORY_NODE_BIN" ]; then
  printf '未找到 Node.js，请安装 Node 22.14 或更高版本。\n' >&2
  exit 1
fi
export PATH="$(dirname "$TRAJECTORY_NODE_BIN"):$PATH"
node --input-type=module -e 'const [major,minor]=process.versions.node.split(".").map(Number);if(major<22||(major===22&&minor<14)){console.error("需要 Node 22.14 或更高版本。");process.exit(1)}'
if [ ! -d node_modules ]; then npm ci --no-audit --no-fund; fi
if [ "${1:-}" = '--dev' ]; then
  exec npm run dev
fi
if [ ! -f dist/index.html ]; then npm run build; fi
exec npm start
