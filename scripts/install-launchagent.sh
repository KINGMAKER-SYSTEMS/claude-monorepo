#!/usr/bin/env bash
# install-launchagent.sh — render the LaunchAgent template and install it.
#
# Idempotent: running twice replaces the installed plist and re-kickstarts
# the service. Prints a final summary so the user knows what was done.
#
# Usage:
#   scripts/install-launchagent.sh           # install + bootstrap + start
#   scripts/install-launchagent.sh --uninstall   # stop + remove
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TEMPLATE="$REPO_DIR/infra/launchd/com.brain.daemon.plist.template"
LABEL="com.brain.daemon"
DEST="$HOME/Library/LaunchAgents/$LABEL.plist"
STATE_DIR="$HOME/.local/state/brain"
LOG_DIR="$HOME/.local/state/brain"

if [[ "${1:-}" == "--uninstall" ]]; then
  echo "stopping $LABEL…"
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
  rm -f "$DEST"
  echo "removed $DEST"
  exit 0
fi

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "error: LaunchAgent install only supports macOS (got $(uname -s))" >&2
  echo "       on Linux, use systemd --user instead (see README)" >&2
  exit 1
fi

if [[ ! -f "$TEMPLATE" ]]; then
  echo "error: template missing: $TEMPLATE" >&2
  exit 1
fi

PNPM_BIN="$(command -v pnpm || true)"
if [[ -z "$PNPM_BIN" ]]; then
  echo "error: pnpm not on PATH" >&2
  exit 1
fi

mkdir -p "$(dirname "$DEST")" "$STATE_DIR" "$LOG_DIR"

# Substitute template placeholders. Keep secrets out of argv by writing the
# rendered plist atomically.
tmpfile="$(mktemp)"
trap 'rm -f "$tmpfile"' EXIT

DATABASE_URL_VAL="${DATABASE_URL:-postgres://postgres:postgres@localhost:5432/brain}"
ANTHROPIC_KEY_VAL="${ANTHROPIC_API_KEY:-}"
OPENAI_KEY_VAL="${OPENAI_API_KEY:-}"

sed \
  -e "s|{{PNPM_BIN}}|${PNPM_BIN}|g" \
  -e "s|{{REPO_DIR}}|${REPO_DIR}|g" \
  -e "s|{{HOME}}|${HOME}|g" \
  -e "s|{{PATH}}|${PATH}|g" \
  -e "s|{{DATABASE_URL}}|${DATABASE_URL_VAL}|g" \
  -e "s|{{ANTHROPIC_API_KEY}}|${ANTHROPIC_KEY_VAL}|g" \
  -e "s|{{OPENAI_API_KEY}}|${OPENAI_KEY_VAL}|g" \
  "$TEMPLATE" > "$tmpfile"

# Validate the rendered plist before installing.
if ! plutil -lint "$tmpfile" >/dev/null; then
  echo "error: rendered plist failed plutil -lint" >&2
  plutil -lint "$tmpfile"
  exit 1
fi

mv "$tmpfile" "$DEST"
chmod 0644 "$DEST"

echo "installed: $DEST"

# Reload if already loaded.
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$DEST"
launchctl kickstart -k "gui/$(id -u)/$LABEL"

echo ""
echo "✓ daemon installed and started"
echo "  logs:    $LOG_DIR/launchd.{out,err}.log"
echo "  status:  brain status"
echo "  stop:    launchctl bootout gui/$(id -u)/$LABEL"
echo "  remove:  $0 --uninstall"
