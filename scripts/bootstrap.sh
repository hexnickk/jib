#!/usr/bin/env bash
set -euo pipefail

# set up git hooks
if git rev-parse --show-toplevel >/dev/null 2>&1; then
  echo "bootstrap: configuring Git hooks"
  git config core.hooksPath .githooks
fi

# install codex
npm i -g @openai/codex

# install pi
npm install -g --ignore-scripts @earendil-works/pi-coding-agent
