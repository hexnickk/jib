#!/usr/bin/env bash
set -euo pipefail

append_line_once() {
  local file="$1"
  local line="$2"
  mkdir -p "$(dirname "$file")"
  touch "$file"
  grep -Fqx "$line" "$file" || printf '%s\n' "$line" >> "$file"
}

# set up git hooks
if git rev-parse --show-toplevel >/dev/null 2>&1; then
  echo "bootstrap: configuring Git hooks"
  git config core.hooksPath .githooks
fi

# install bun
if [ ! -x "$HOME/.bun/bin/bun" ]; then
  echo "bootstrap: installing Bun"
  curl -fsSL https://bun.sh/install | bash
fi

# ensure bun is on PATH for future shells
append_line_once "$HOME/.profile" 'export BUN_INSTALL="$HOME/.bun"'
append_line_once "$HOME/.profile" 'case ":$PATH:" in'
append_line_once "$HOME/.profile" '  *":$BUN_INSTALL/bin:"*) ;;'
append_line_once "$HOME/.profile" '  *) export PATH="$BUN_INSTALL/bin:$PATH" ;;'
append_line_once "$HOME/.profile" 'esac'
export BUN_INSTALL="$HOME/.bun"
case ":$PATH:" in
  *":$BUN_INSTALL/bin:"*) ;;
  *) export PATH="$BUN_INSTALL/bin:$PATH" ;;
esac

# install nvm
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.4/install.sh | bash
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"  # This loads nvm
[ -s "$NVM_DIR/bash_completion" ] && \. "$NVM_DIR/bash_completion"  # This loads nvm bash_completion

# install node
nvm install 22

# install codex
npm i -g @openai/codex
