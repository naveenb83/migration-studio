#!/usr/bin/env bash
# Build the READY-TO-DEPLOY app once, into ../app_release/. Needs Node 20+ on this laptop (only for this build).
# The release is one self-contained server bundle + the prebuilt browser files, and no package.json, so a workspace
# never runs npm install (some workspaces' npm proxies are missing packages). install.py deploys app_release/ as is.
set -euo pipefail
cd "$(dirname "$0")"
npm install --no-audit --no-fund
npm run bundle:client                       # browser bundle -> client/prebuilt
npx tsdown -c release.tsdown.config.ts      # server + every package -> release/server/*.mjs
rm -rf release/client release/app.yaml && mkdir -p release/client
cp -R client/prebuilt release/client/dist
cp appkit.plugins.json release/ && cp -R config release/
python3 - <<'PY'
src = open('app.yaml').read()
out = src.replace("command: ['npm', 'run', 'start']", "command: ['node', 'server/server.mjs']")
assert out != src, "app.yaml start command changed: update build_release.sh"
out = out.replace("env:\n", "env:\n  - name: NODE_ENV\n    value: production\n", 1) if "NODE_ENV" not in out else out
open('release/app.yaml', 'w').write(out)
PY
rm -rf ../app_release && cp -R release ../app_release
echo "built ../app_release ($(du -sh ../app_release | cut -f1)). Test it outside this folder before deploying:"
echo "  cp -R ../app_release /tmp/msr && cd /tmp/msr && NODE_ENV=production DATABRICKS_APP_PORT=8124 node --env-file=<a .env> server/server.mjs"
