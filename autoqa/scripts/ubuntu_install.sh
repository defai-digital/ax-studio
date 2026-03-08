#!/bin/bash
# Ubuntu install script for Ax-Studio app

IS_NIGHTLY="$1"

INSTALLER_PATH="/tmp/ax-studio-installer.deb"

echo "Installing Ax-Studio app..."
echo "Is nightly build: $IS_NIGHTLY"

# Install the .deb package
sudo apt install "$INSTALLER_PATH" -y
sudo apt-get install -f -y

# Wait for installation to complete
sleep 10

echo "[INFO] Waiting for Ax-Studio app first initialization (120 seconds)..."
echo "This allows Ax-Studio to complete its initial setup and configuration"
sleep 120
echo "[SUCCESS] Initialization wait completed"

# Verify installation based on nightly flag
if [ "$IS_NIGHTLY" = "true" ]; then
    DEFAULT_JAN_PATH="/usr/bin/Ax-Studio-nightly"
    PROCESS_NAME="Ax-Studio-nightly"
else
    DEFAULT_JAN_PATH="/usr/bin/Ax-Studio"
    PROCESS_NAME="Ax-Studio"
fi

if [ -f "$DEFAULT_JAN_PATH" ]; then
    echo "Ax-Studio app installed successfully at: $DEFAULT_JAN_PATH"
    echo "AX_STUDIO_APP_PATH=$DEFAULT_JAN_PATH" >> $GITHUB_ENV
    echo "AX_STUDIO_PROCESS_NAME=$PROCESS_NAME" >> $GITHUB_ENV
else
    echo "Ax-Studio app not found at expected location: $DEFAULT_JAN_PATH"
    echo "Will auto-detect during test run"
fi
