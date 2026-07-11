#!/usr/bin/env bash
# Renames the workspace name in package.json for beta/nightly channels.
#
# Usage: rename-workspace.sh <package.json path> <channel>
# Example: rename-workspace.sh ./package.json beta

set -euo pipefail

PKG_PATH="${1:?usage: rename-workspace.sh <package.json> <channel>}"
CHANNEL="${2:?usage: rename-workspace.sh <package.json> <channel>}"

if [ ! -f "$PKG_PATH" ]; then
  echo "error: package.json not found: $PKG_PATH" >&2
  exit 1
fi

if [ -z "$CHANNEL" ] || [ "$CHANNEL" = "stable" ]; then
  echo "rename-workspace: skipping (channel is stable or empty)"
  exit 0
fi

NEW_NAME="ax-studio-${CHANNEL}"

if command -v jq >/dev/null 2>&1; then
  jq --arg name "$NEW_NAME" '.name = $name' "$PKG_PATH" > "${PKG_PATH}.tmp"
  mv "${PKG_PATH}.tmp" "$PKG_PATH"
else
  # Fallback: sed replacement
  sed -i.bak "s/\"name\":[[:space:]]*\"[^\"]*\"/\"name\": \"${NEW_NAME}\"/" "$PKG_PATH"
  rm -f "${PKG_PATH}.bak"
fi

echo "rename-workspace: name → ${NEW_NAME}"
