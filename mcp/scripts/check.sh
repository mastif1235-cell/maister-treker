#!/usr/bin/env bash
# Syntax check every JS file of the MCP project (ESM: package.json type=module,
# so plain `node --check` resolves the module goal from package.json scope).
set -euo pipefail
cd "$(dirname "$0")/.."
status=0
while IFS= read -r file; do
  node --check "$file" || status=1
done < <(find src test scripts -name '*.js' -type f | sort)
exit "$status"
