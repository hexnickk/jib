#!/usr/bin/env bash
set -euo pipefail

if git rev-parse --show-toplevel >/dev/null 2>&1; then
  echo "bootstrap: configuring Git hooks"
  git config core.hooksPath .githooks
fi
