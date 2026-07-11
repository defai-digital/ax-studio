#!/usr/bin/env bash
# Renames the productName in tauri.conf.json for beta/nightly channels.
#
# Usage: rename-tauri-app.sh <tauri.conf.json path> <channel>
# Example: rename-tauri-app.sh ./src-tauri/tauri.conf.json beta

set -euo pipefail

CONF_PATH="${1:?usage: rename-tauri-app.sh <conf.json> <channel>}"
CHANNEL="${2:?usage: rename-tauri-app.sh <conf.json> <channel>}"

if [ ! -f "$CONF_PATH" ]; then
  echo "error: config file not found: $CONF_PATH" >&2
  exit 1
fi

if [ -z "$CHANNEL" ] || [ "$CHANNEL" = "stable" ]; then
  echo "rename-tauri-app: skipping (channel is stable or empty)"
  exit 0
fi

NEW_NAME="AX Studio-${CHANNEL}"

if command -v jq >/dev/null 2>&1; then
  jq --arg name "$NEW_NAME" '.productName = $name' "$CONF_PATH" > "${CONF_PATH}.tmp"
  mv "${CONF_PATH}.tmp" "$CONF_PATH"
else
  # Fallback: sed replacement (less robust but works without jq)
  sed -i.bak "s/\"productName\":[[:space:]]*\"[^\"]*\"/\"productName\": \"${NEW_NAME}\"/" "$CONF_PATH"
  rm -f "${CONF_PATH}.bak"
fi

echo "rename-tauri-app: productName → ${NEW_NAME}"
