#!/usr/bin/env bash
set -euo pipefail

TMUX_CONFIG_FILE="${TMUX_CONFIG_FILE:-$HOME/.tmux.conf}"

if command -v tmux &>/dev/null; then
    echo "tmux already installed: $(command -v tmux)"
    tmux -V
else
    echo "Installing tmux with apt-get"
    if [ "$(id -u)" -eq 0 ]; then
        apt-get update -qq
        apt-get install -y -qq tmux >/dev/null
    else
        sudo apt-get update -qq
        sudo apt-get install -y -qq tmux >/dev/null
    fi

    echo "tmux installed: $(command -v tmux)"
    tmux -V
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

echo "tmux config written: $TMUX_CONFIG_FILE"
echo "Start tmux with: tmux new -s dev"
echo "Detach with: Ctrl-b then d"
echo "Scroll with: mouse wheel, or Ctrl-b then [ and Vim keys"
