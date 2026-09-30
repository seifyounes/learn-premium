#!/usr/bin/env bash
# Prints the same-repo issue numbers a PR body closes, one per line, in order and without
# repeats. It reads the body on stdin and accepts GitHub's closing keywords (close, closes,
# closed, fix, fixes, fixed, resolve, resolves, resolved), in any case, with or without a colon:
# "Closes #41", "fixes: #7". A keyword that names another repo (owner/repo#N) is skipped.
set -euo pipefail

grep -oiE '(^|[^[:alnum:]_/])(close[sd]?|fix(e[sd])?|resolve[sd]?):?[[:space:]]+#[0-9]+' |
  grep -oE '#[0-9]+$' |
  tr -d '#' |
  awk '!seen[$0]++' || true
