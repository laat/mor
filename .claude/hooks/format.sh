#!/bin/bash
FILE_PATH=$(jq -r '.tool_input.file_path // empty')
if [ -n "$FILE_PATH" ] && [ -f "$FILE_PATH" ]; then
  cd "$CLAUDE_PROJECT_DIR" && npx prettier --write "$FILE_PATH" 2>/dev/null || true
fi
