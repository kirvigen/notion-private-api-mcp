#!/bin/zsh
set -eu

# Resolve the project directory from this script's location so the launcher
# works regardless of where the repo is checked out.
SCRIPT_DIR="${0:A:h}"
SERVER="$SCRIPT_DIR/src/server.js"
NODE="$(command -v node)"
LOG_FILE="${NOTION_MCP_LOG:-/tmp/notion-private-codex.log}"

{
  echo "==== $(date '+%Y-%m-%d %H:%M:%S') ===="
  echo "PWD=$(pwd)"
  echo "USER=${USER:-}"
  echo "HOME=${HOME:-}"
  echo "NODE=$NODE"
  echo "SCRIPT=$SERVER"
  echo "HAS_TOKEN=$([ -n \"${NOTION_TOKEN_V2:-}\" ] && echo yes || echo no)"
  echo "PRIVATE_API_BASE=${NOTION_PRIVATE_API_BASE:-}"
} >> "$LOG_FILE"

exec "$NODE" "$SERVER" 2>> "$LOG_FILE"
