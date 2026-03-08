#!/bin/bash
# macOS download script for Ax-Studio app

WORKFLOW_INPUT_URL="$1"
WORKFLOW_INPUT_IS_NIGHTLY="$2"
REPO_VARIABLE_URL="$3"
REPO_VARIABLE_IS_NIGHTLY="$4"
DEFAULT_URL="$5"
DEFAULT_IS_NIGHTLY="$6"

# Determine Ax-Studio app URL and nightly flag from multiple sources (priority order):
# 1. Workflow dispatch input (manual trigger)
# 2. Repository variable JAN_APP_URL
# 3. Default URL from env

JAN_APP_URL=""
IS_NIGHTLY="false"

if [ -n "$WORKFLOW_INPUT_URL" ]; then
    JAN_APP_URL="$WORKFLOW_INPUT_URL"
    IS_NIGHTLY="$WORKFLOW_INPUT_IS_NIGHTLY"
    echo "Using Ax-Studio app URL from workflow input: $JAN_APP_URL"
    echo "Is nightly build: $IS_NIGHTLY"
elif [ -n "$REPO_VARIABLE_URL" ]; then
    JAN_APP_URL="$REPO_VARIABLE_URL"
    IS_NIGHTLY="$REPO_VARIABLE_IS_NIGHTLY"
    echo "Using Ax-Studio app URL from repository variable: $JAN_APP_URL"
    echo "Is nightly build: $IS_NIGHTLY"
else
    JAN_APP_URL="$DEFAULT_URL"
    IS_NIGHTLY="$DEFAULT_IS_NIGHTLY"
    echo "Using default Ax-Studio app URL: $JAN_APP_URL"
    echo "Is nightly build: $IS_NIGHTLY"
fi

# Export for later steps
echo "JAN_APP_URL=$JAN_APP_URL" >> $GITHUB_ENV
echo "IS_NIGHTLY=$IS_NIGHTLY" >> $GITHUB_ENV

echo "Downloading Ax-Studio app from: $JAN_APP_URL"
curl -L -o "/tmp/ax-studio-installer.dmg" "$JAN_APP_URL"

if [ ! -f "/tmp/ax-studio-installer.dmg" ]; then
    echo "[FAILED] Failed to download Ax-Studio app"
    exit 1
fi

echo "[SUCCESS] Successfully downloaded Ax-Studio app"
ls -la "/tmp/ax-studio-installer.dmg"
