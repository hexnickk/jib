#!/usr/bin/env bash
set -euo pipefail

NODE_VERSION="${NODE_VERSION:-22}"

export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"

NVM_PROFILE="${NVM_PROFILE:-}"
if [[ -z "$NVM_PROFILE" ]]; then
    case "${SHELL:-}" in
        */zsh) NVM_PROFILE="$HOME/.zshrc" ;;
        *) NVM_PROFILE="$HOME/.bashrc" ;;
    esac
fi

mkdir -p "$(dirname "$NVM_PROFILE")"
touch "$NVM_PROFILE"
if ! grep -Fq 'nvm.sh' "$NVM_PROFILE"; then
    cat >>"$NVM_PROFILE" <<EOF

export NVM_DIR="$NVM_DIR"
[ -s "\$NVM_DIR/nvm.sh" ] && \. "\$NVM_DIR/nvm.sh"
EOF
fi

if [[ -s "$NVM_DIR/nvm.sh" ]]; then
    # shellcheck source=/dev/null
    source "$NVM_DIR/nvm.sh" --no-use
fi

if ! command -v nvm &>/dev/null; then
    echo "nvm not found; installing nvm..."
    mkdir -p "$NVM_DIR"
    NVM_INSTALL_VERSION="${NVM_INSTALL_VERSION:-v0.40.3}"
    curl -fsSL "https://raw.githubusercontent.com/nvm-sh/nvm/$NVM_INSTALL_VERSION/install.sh" | bash
    # shellcheck source=/dev/null
    source "$NVM_DIR/nvm.sh" --no-use
fi

nvm install "$NODE_VERSION"
nvm use "$NODE_VERSION"

echo "node: $(node --version)"
echo "npm: $(npm --version)"
