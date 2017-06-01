#!/bin/bash
set -e

cd "$(mor-root)"
jsfiles=$(git ls-files | grep '\.js$' | tr '\n' ' ')
./scripts/tool prettier --write $jsfiles
