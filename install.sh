#!/bin/sh
# learn-premium installer. Safe to re-run: it brings this machine to the latest Template release
# (worktree, state folder, venv, skill link, Playwright Chromium + WebKit). See docs/install.md.
# Needs git, uv and Node.js LTS (for npx) on PATH.
set -e
exec uv run --no-project --python '>=3.12' "$(dirname "$0")/skill/scripts/machine_install.py" install "$@"
