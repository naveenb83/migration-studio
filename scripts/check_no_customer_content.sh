#!/usr/bin/env bash
# Blocks commits/pushes that contain customer-identifying strings.
# Patterns live in local/denylist.txt (git-ignored, one extended regex per line, case-sensitive; '#' comments allowed).
set -euo pipefail
root="$(git rev-parse --show-toplevel)"
deny="$root/local/denylist.txt"
if [[ ! -f "$deny" ]]; then
  echo "ERROR: $deny is missing. Ask Naveen for the denylist before committing or pushing." >&2
  exit 1
fi
patterns="$(grep -v '^\s*#' "$deny" | grep -v '^\s*$' | paste -sd'|' -)"
[[ -z "$patterns" ]] && { echo "ERROR: denylist is empty" >&2; exit 1; }
hits="$(git -C "$root" ls-files -z | xargs -0 grep -nE "$patterns" -- 2>/dev/null || true)"
if [[ -n "$hits" ]]; then
  echo "BLOCKED: customer-identifying content found in tracked files:" >&2
  echo "$hits" | sed -E 's/^([^:]+:[0-9]+):.*/  \1/' | sort -u >&2
  exit 1
fi
echo "denylist scan: clean"
