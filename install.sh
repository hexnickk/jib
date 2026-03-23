#!/bin/bash
set -euo pipefail

# Jib installer — downloads the latest release binary to /usr/local/bin/jib
# Usage: curl -fsSL https://raw.githubusercontent.com/hexnickk/jib/main/install.sh | bash

REPO="hexnickk/jib"
INSTALL_DIR="/usr/local/bin"
BINARY="jib"

# Detect OS and arch
OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
ARCH="$(uname -m)"

case "$ARCH" in
  x86_64)  ARCH="amd64" ;;
  aarch64) ARCH="arm64" ;;
  arm64)   ARCH="arm64" ;;
  *)
    echo "Error: unsupported architecture: $ARCH"
    exit 1
    ;;
esac

case "$OS" in
  linux)  ;;
  darwin) ;;
  *)
    echo "Error: unsupported OS: $OS"
    exit 1
    ;;
esac

# Get latest release tag
echo "Fetching latest release..."
TAG=$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" | grep '"tag_name"' | cut -d'"' -f4)

if [ -z "$TAG" ]; then
  echo "Error: could not determine latest release. Check https://github.com/${REPO}/releases"
  exit 1
fi

echo "Latest version: $TAG"

# Download binary
URL="https://github.com/${REPO}/releases/download/${TAG}/jib-${OS}-${ARCH}"
echo "Downloading ${URL}..."

TMP=$(mktemp)
trap 'rm -f "$TMP"' EXIT

if ! curl -fsSL -o "$TMP" "$URL"; then
  echo "Error: download failed. Check that a release exists for ${OS}/${ARCH} at:"
  echo "  https://github.com/${REPO}/releases/tag/${TAG}"
  exit 1
fi

chmod +x "$TMP"

# Install
if [ -w "$INSTALL_DIR" ]; then
  mv "$TMP" "${INSTALL_DIR}/${BINARY}"
else
  echo "Installing to ${INSTALL_DIR} (requires sudo)..."
  sudo mv "$TMP" "${INSTALL_DIR}/${BINARY}"
fi

echo "Installed jib ${TAG} to ${INSTALL_DIR}/${BINARY}"
echo ""

# Run init automatically
"${INSTALL_DIR}/${BINARY}" init
