#!/usr/bin/env bash
# Memberberry hook for Claude Code
# Hints at relevant mor memories so Claude can choose to read them.
#
# Configure in ~/.claude/settings.json:
#   "hooks": {
#     "UserPromptSubmit": [{ "command": "/path/to/memberberry.sh" }]
#   }

set -euo pipefail

input=$(cat)
session_id=$(echo "$input" | jq -r '.session_id')
prompt=$(echo "$input" | jq -r '.prompt')

# Skip short prompts and slash commands
if [ ${#prompt} -lt 10 ] || [[ "$prompt" == /* ]]; then
  exit 0
fi

cache_dir="/tmp/mor-memberberry"
mkdir -p "$cache_dir"
cache_file="$cache_dir/$session_id"
touch "$cache_file"

hits=$(mor find "$prompt" --limit 3 --json 2>/dev/null) || exit 0

# Filter out already-surfaced memories
new=$(echo "$hits" | jq --slurpfile seen <(jq -R . "$cache_file") '
  [.[] | select(.id as $id | $seen | map(select(. == $id)) | length == 0)]
')

count=$(echo "$new" | jq 'length')
[ "$count" -eq 0 ] && exit 0

# Record surfaced IDs
echo "$new" | jq -r '.[].id' >> "$cache_file"

# Output hints — just enough for Claude to decide whether to read more
echo ""
echo "[mor] Potentially relevant memories (use mor MCP tools to read if needed):"
echo "$new" | jq -r '.[] | "  - \(.title) [\(.id[0:8])]" + (if .description then " — \(.description)" else "" end)'
