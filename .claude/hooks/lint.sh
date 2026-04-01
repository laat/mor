#!/bin/bash
FILE_PATH=$(jq -r '.tool_input.file_path // empty')
if [ -n "$FILE_PATH" ] && [[ "$FILE_PATH" == *.ts ]]; then
  cd "$CLAUDE_PROJECT_DIR" && npx eslint --quiet "$FILE_PATH" 2>/dev/null || true
fi
