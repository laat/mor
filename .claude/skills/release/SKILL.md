---
name: release
description: Bump version, commit, push, and create a GitHub release with changelog
disable-model-invocation: true
---

Create a release for mor. The user provides the version number (e.g. `/release v0.12.0`).

## Steps

1. **Parse version**: Strip leading `v` if present to get the semver (e.g. `0.12.0`). The tag uses `v` prefix (e.g. `v0.12.0`).

2. **Pre-flight check**: Run `pnpm prepublishOnly` (lint, test, build) before making any changes. If it fails, stop and fix the issues first.

3. **Find previous release tag**: Run `gh release list --limit 1` to get the latest release tag.

4. **Build changelog**: Run `git log <previous-tag>..HEAD --oneline` to get all commits since the last release. Group them into sections:
   - **Features** — new functionality
   - **Fixes** — bug fixes
   - **Docs** — documentation changes
   - **Internal** — refactoring, tests, build changes

   Skip version bump commits. Write concise user-facing descriptions, not raw commit messages.

5. **Show the changelog to the user** and ask for approval before proceeding.

6. **Bump version**: Update `version` in `package.json`, `.claude-plugin/plugin.json`, and the `.TH` header line of `man/mor.1` to the new semver. The `.TH` line in `man/mor.1` also carries a release date — update it to today's date in `YYYY-MM-DD` format. Format: `.TH MOR 1 "<date>" "mor <semver>" "User Commands"`.

7. **Commit and push**: Commit with message `<semver>` (e.g. `0.12.0`), then push.

8. **Create GitHub release**: Run `gh release create v<semver>` with the changelog as the body. Use `## What's new` as the top-level heading.

9. **Publish to npm**: Ask the user to run `pnpm publish --access public` interactively themselves (it requires OTP authentication). Do NOT run it directly.
