#!/usr/bin/env bash
#
# Install the `brain` MCP server into Claude Desktop's config.
#
# Claude Desktop reads MCP servers from:
#   macOS:   ~/Library/Application Support/Claude/claude_desktop_config.json
#
# This script merges (not overwrites) the existing `mcpServers` block so we
# don't clobber other servers the user has installed.
#
# Usage:
#   ./scripts/install-mcp.sh                 # install
#   ./scripts/install-mcp.sh --uninstall     # remove
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
MCP_BIN="${REPO_DIR}/packages/mcp/src/bin.ts"
CFG_DIR="${HOME}/Library/Application Support/Claude"
CFG_FILE="${CFG_DIR}/claude_desktop_config.json"

UNINSTALL=0
for arg in "$@"; do
  case "$arg" in
    --uninstall|-u) UNINSTALL=1 ;;
    -h|--help)
      sed -n '1,20p' "$0"
      exit 0
      ;;
  esac
done

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "install-mcp: only macOS Claude Desktop config is supported right now." >&2
  exit 2
fi

command -v jq >/dev/null 2>&1 || { echo "jq required (brew install jq)" >&2; exit 2; }

# Prefer repo-local tsx (matches the tsconfig that compiled the server).
if [[ -x "${REPO_DIR}/node_modules/.bin/tsx" ]]; then
  TSX_BIN="${REPO_DIR}/node_modules/.bin/tsx"
elif command -v tsx >/dev/null 2>&1; then
  TSX_BIN="$(command -v tsx)"
else
  echo "tsx not found — run: pnpm install at repo root" >&2
  exit 2
fi

mkdir -p "$CFG_DIR"
if [[ ! -f "$CFG_FILE" ]]; then
  echo '{}' > "$CFG_FILE"
fi

DATABASE_URL_VAL="${DATABASE_URL:-postgres://brain:brain@localhost:5433/brain}"

if [[ "$UNINSTALL" == "1" ]]; then
  jq 'if .mcpServers then del(.mcpServers.brain) else . end' "$CFG_FILE" > "$CFG_FILE.tmp"
  mv "$CFG_FILE.tmp" "$CFG_FILE"
  echo "✓ removed 'brain' from $CFG_FILE"
  echo "  restart Claude Desktop to apply."
  exit 0
fi

if [[ ! -f "$MCP_BIN" ]]; then
  echo "install-mcp: cannot find $MCP_BIN" >&2
  exit 2
fi

TMP="$(mktemp)"
jq \
  --arg cmd "$TSX_BIN" \
  --arg arg0 "$MCP_BIN" \
  --arg db "$DATABASE_URL_VAL" \
  '
  .mcpServers //= {} |
  .mcpServers.brain = {
    command: $cmd,
    args: [$arg0],
    env: {
      DATABASE_URL: $db,
      BRAIN_EMBEDDER_KIND: (env.BRAIN_EMBEDDER_KIND // "ollama")
    }
  }
  ' "$CFG_FILE" > "$TMP"
mv "$TMP" "$CFG_FILE"

echo "✓ installed 'brain' MCP server"
echo "  config: $CFG_FILE"
echo "  bin:    $TSX_BIN $MCP_BIN"
echo "  db:     $DATABASE_URL_VAL"
echo ""
echo "Next:"
echo "  1. Quit and relaunch Claude Desktop."
echo "  2. The 10 brain_* tools will appear in the Settings → Developer panel."
echo "  3. Create a Routine that calls brain_standup for your morning brief."
