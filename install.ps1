# learn-premium installer. Safe to re-run: it brings this machine to the latest Template release
# (worktree, state folder, venv, skill junction, Playwright Chromium + WebKit). See docs/install.md.
# Needs git, uv (winget install astral-sh.uv) and Node.js LTS (for npx) on PATH.
$ErrorActionPreference = 'Stop'
uv run --no-project --python '>=3.12' "$PSScriptRoot\skill\scripts\machine_install.py" install @args
exit $LASTEXITCODE
