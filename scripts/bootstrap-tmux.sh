#!/usr/bin/env bash
set -euo pipefail

TMUX_CONFIG_FILE="${TMUX_CONFIG_FILE:-$HOME/.tmux.conf}"
TMUX_MIN_VERSION="${TMUX_MIN_VERSION:-3.5}"
TMUX_SOURCE_VERSION="${TMUX_SOURCE_VERSION:-3.5a}"
TMUX_INSTALL_PREFIX="${TMUX_INSTALL_PREFIX:-/usr/local}"

# Run a command as root. Inputs are the command and args; output/side effects are
# whatever that command performs. Uses sudo only when the current user is non-root.
as_root() {
    if [ "$(id -u)" -eq 0 ]; then
        "$@"
    else
        sudo "$@"
    fi
}

# Return the installed tmux version number, or an empty string when tmux is absent.
# Input is PATH; output is stdout only; no side effects.
tmux_version() {
    if ! command -v tmux &>/dev/null; then
        return 0
    fi

    tmux -V | awk '{print $2}'
}

# Check whether the first version is greater than or equal to the second version.
# Inputs are two dotted/suffixed version strings; output is the shell return code.
tmux_version_at_least() {
    local current="$1"
    local required="$2"
    [ "$(printf '%s\n%s\n' "$required" "$current" | sort -V | head -n 1)" = "$required" ]
}

# Return the running tmux server version, or an empty string when no server is
# reachable. Input is PATH; output is stdout only; no side effects.
tmux_server_version() {
    if ! command -v tmux &>/dev/null; then
        return 0
    fi

    tmux display-message -p '#{version}' 2>/dev/null || true
}

# Warn when an old tmux server is still running. Inputs are PATH and
# TMUX_MIN_VERSION; output is stderr; no side effects.
tmux_warn_if_old_server_running() {
    local server_version
    server_version="$(tmux_server_version)"

    if [ -z "$server_version" ] || tmux_version_at_least "$server_version" "$TMUX_MIN_VERSION"; then
        return 0
    fi

    cat >&2 <<EOF

IMPORTANT: tmux client is $(tmux_version), but the running tmux server is ${server_version}.
The old server cannot load 'extended-keys-format csi-u'. Restart tmux fully:

    tmux kill-server
    tmux new -s dev

Run this from outside tmux if possible; it will close existing tmux sessions.
EOF
}

# Build and install tmux from an upstream release tarball. Inputs are the TMUX_*
# environment variables; side effects are apt packages and a tmux install under
# TMUX_INSTALL_PREFIX.
tmux_install_from_source() {
    local archive_url="https://github.com/tmux/tmux/releases/download/${TMUX_SOURCE_VERSION}/tmux-${TMUX_SOURCE_VERSION}.tar.gz"
    local tmp_dir
    tmp_dir="$(mktemp -d)"
    trap "rm -rf '$tmp_dir'" EXIT

    echo "Installing tmux ${TMUX_SOURCE_VERSION} from source"
    as_root apt-get update -qq
    as_root apt-get install -y -qq \
        bison \
        build-essential \
        ca-certificates \
        curl \
        libevent-dev \
        libncurses-dev \
        pkg-config >/dev/null

    curl -fsSL "$archive_url" -o "$tmp_dir/tmux.tar.gz"
    tar -xzf "$tmp_dir/tmux.tar.gz" -C "$tmp_dir"

    (
        cd "$tmp_dir/tmux-${TMUX_SOURCE_VERSION}"
        ./configure --prefix="$TMUX_INSTALL_PREFIX"
        make -j"$(nproc)"
        as_root make install
    )
}

installed_tmux_version="$(tmux_version)"
if [ -n "$installed_tmux_version" ] && tmux_version_at_least "$installed_tmux_version" "$TMUX_MIN_VERSION"; then
    echo "tmux already installed: $(command -v tmux)"
    tmux -V
else
    if [ -n "$installed_tmux_version" ]; then
        echo "tmux ${installed_tmux_version} is older than required ${TMUX_MIN_VERSION}"
    else
        echo "tmux is not installed"
    fi

    tmux_install_from_source
    hash -r

    echo "tmux installed: $(command -v tmux)"
    tmux -V
fi

installed_tmux_version="$(tmux_version)"
if ! tmux_version_at_least "$installed_tmux_version" "$TMUX_MIN_VERSION"; then
    echo "tmux ${installed_tmux_version:-missing} is still older than required ${TMUX_MIN_VERSION}" >&2
    exit 1
fi

mkdir -p "$(dirname "$TMUX_CONFIG_FILE")"
cat > "$TMUX_CONFIG_FILE" <<'EOF'
# Minimal tmux config: scrollable, Vim-friendly, and low-surprise defaults.

# Keep tmux default prefix: Ctrl-b.
# Common optional switch is Ctrl-a, but default is easier when pairing or reading docs.

# Better terminal behavior for modern shells/editors.
set -g default-terminal "tmux-256color"
set -g focus-events on
set -g set-clipboard on
set -as terminal-features ',xterm-256color:RGB'
set -as terminal-features ',xterm*:extkeys'
set -g extended-keys always
set -g extended-keys-format csi-u
set -sg escape-time 10

# Make scroll wheel and pane/window selection work with the mouse.
# Also enables click-and-drag pane resize.
set -g mouse on

# Keep more scrollback than the small default.
set -g history-limit 100000

# Use Vim keys in copy mode: prefix+[ then h/j/k/l, /, ?, n, N, etc.
setw -g mode-keys vi
bind-key -T copy-mode-vi v send -X begin-selection
bind-key -T copy-mode-vi y send -X copy-selection-and-cancel
bind-key -T copy-mode-vi C-v send -X rectangle-toggle

# Do not copy automatically when a mouse selection is released.
# Keep the selection active so pressing y in vi copy mode still copies it.
unbind-key -T copy-mode MouseDragEnd1Pane
unbind-key -T copy-mode-vi MouseDragEnd1Pane

# Vim-style pane movement after prefix: prefix+h/j/k/l.
bind-key h select-pane -L
bind-key j select-pane -D
bind-key k select-pane -U
bind-key l select-pane -R

# Resize panes with repeatable Vim-style uppercase keys: prefix+H/J/K/L.
bind-key -r H resize-pane -L 5
bind-key -r J resize-pane -D 5
bind-key -r K resize-pane -U 5
bind-key -r L resize-pane -R 5

# More convenient numbering and automatic cleanup after closing windows.
set -g base-index 1
setw -g pane-base-index 1
set -g renumber-windows on

# New panes/windows start in the current pane's directory.
bind-key c new-window -c "#{pane_current_path}"
bind-key '"' split-window -v -c "#{pane_current_path}"
bind-key % split-window -h -c "#{pane_current_path}"
bind-key -- - split-window -v -c "#{pane_current_path}"
bind-key | split-window -h -c "#{pane_current_path}"

# Quick config reload.
bind-key r source-file ~/.tmux.conf \; display-message "tmux config reloaded"
EOF

tmux_warn_if_old_server_running

echo "tmux config written: $TMUX_CONFIG_FILE"
echo "If this shell used old tmux before bootstrap, clear its command cache with: hash -r"
echo "Verify with: command -v tmux && tmux -V"
echo "If tmux is already running, restart it with: tmux kill-server"
echo "Start tmux with: tmux new -s dev"
echo "Detach with: Ctrl-b then d"
echo "Scroll with: mouse wheel, or Ctrl-b then [ and Vim keys"
