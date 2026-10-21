#!/usr/bin/env bash
set -euo pipefail
cd /workspace/novel_machine
export npm_config_cache=/workspace/.cache/npm
node -e 'if (Number(process.versions.node.split(".")[0]) < 24) { throw new Error("Node.js 24 or newer is required"); }'
npm ci --no-audit --no-fund
npm run check
mkdir -p /workspace/novel-tools/state
if [ -f /workspace/novel-tools/package-lock.json ]; then
  npm ci --prefix /workspace/novel-tools --no-audit --no-fund
else
  npm install --prefix /workspace/novel-tools --save-exact --no-audit --no-fund @google/gemini-cli@0.65.0
fi
GEMINI_CLI_HOME=/workspace/novel-tools/state /workspace/novel-tools/node_modules/.bin/gemini --version
