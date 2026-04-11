#!/usr/bin/env bash
#
# jib installer. Downloads the prebuilt binaries for the current OS/arch from
# a GitHub release and installs it to /usr/local/bin/jib.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/hexnickk/jib/main/scripts/install.sh | bash
#
# Environment overrides:
#   JIB_VERSION   release tag to install (default: latest)
#   JIB_REPO      GitHub owner/repo to pull from (default: hexnickk/jib)
#   JIB_PREFIX    install directory (default: /usr/local/bin)
#
set -euo pipefail

REPO="${JIB_REPO:-hexnickk/jib}"
PREFIX="${JIB_PREFIX:-/usr/local/bin}"

log()  { printf '==> %s\n' "$*"; }
fail() { printf 'error: %s\n' "$*" >&2; exit 1; }

need() { command -v "$1" >/dev/null 2>&1 || fail "missing required command: $1"; }
run_as_root() {
  if [ "$(id -u)" = "0" ]; then "$@"; else need sudo; sudo "$@"; fi
}
need curl
need uname
need install
need mktemp

os_raw="$(uname -s)"
arch_raw="$(uname -m)"

case "$os_raw" in
  Linux)  os="linux"  ;;
  Darwin) os="darwin" ;;
  *) fail "unsupported OS: $os_raw (jib supports linux, darwin)" ;;
esac

case "$arch_raw" in
  x86_64|amd64)  arch="x64"   ;;
  aarch64|arm64) arch="arm64" ;;
  *) fail "unsupported arch: $arch_raw (jib supports x64, arm64)" ;;
esac

# jib is a server tool; no darwin-x64 release is published.
if [ "$os" = "darwin" ] && [ "$arch" = "x64" ]; then
  fail "darwin-x64 is not supported; use an arm64 mac or a linux host"
fi

target="bun-${os}-${arch}"

if [ -n "${JIB_VERSION:-}" ]; then
  tag="$JIB_VERSION"
else
  log "resolving latest release from $REPO"
  api="https://api.github.com/repos/${REPO}/releases/latest"
  resp="$(curl -fsSL "$api")" || fail "failed to query $api"
  if command -v jq >/dev/null 2>&1; then
    tag="$(printf '%s' "$resp" | jq -r .tag_name)"
  else
    tag="$(printf '%s' "$resp" | grep -o '"tag_name":[[:space:]]*"[^"]*"' | head -n1 | sed 's/.*"\([^"]*\)"$/\1/')"
  fi
  [ -n "$tag" ] && [ "$tag" != "null" ] || fail "could not determine latest release tag"
fi

cli_asset="jib-${target}"
cli_url="https://github.com/${REPO}/releases/download/${tag}/${cli_asset}"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

log "downloading $cli_url"
curl -fsSL "$cli_url" -o "$tmp/jib" || fail "download failed"

chmod +x "$tmp/jib"
if command -v file >/dev/null 2>&1; then
  file "$tmp/jib" | grep -qiE 'executable|Mach-O' || fail "downloaded file is not an executable"
fi

cli_dest="$PREFIX/jib"
log "installing $cli_dest (version $tag)"
if [ -w "$PREFIX" ] || [ "$(id -u)" = "0" ]; then
  install -m 0755 "$tmp/jib" "$cli_dest"
else
  run_as_root install -m 0755 "$tmp/jib" "$cli_dest"
fi

if [ "$os" = "linux" ]; then
  log "running automatic migrations"
  run_as_root "$cli_dest" migrate

  if command -v systemctl >/dev/null 2>&1 && systemctl is-active --quiet jib-watcher.service; then
    log "restarting jib-watcher.service to pick up the new binary"
    run_as_root systemctl restart jib-watcher.service
  fi
fi

log "jib $tag installed"
if [ "$os" = "linux" ]; then
  log "next: run 'sudo jib init' to configure optional modules"
else
  log "automatic migrations skipped on $os; run jib on the target Linux host"
fi
