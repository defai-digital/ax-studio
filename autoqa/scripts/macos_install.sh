#!/bin/bash
# macOS install script for Ax-Studio app

echo "Installing Ax-Studio app from DMG..."

# Mount the DMG
hdiutil attach "/tmp/ax-studio-installer.dmg" -mountpoint "/tmp/ax-studio-mount"

# Find the .app file in the mounted DMG
APP_FILE=$(find "/tmp/ax-studio-mount" -name "*.app" -type d | head -1)

if [ -z "$APP_FILE" ]; then
    echo "[Failed] No .app file found in DMG"
    hdiutil detach "/tmp/ax-studio-mount" || true
    exit 1
fi

echo "Found app file: $APP_FILE"

# Copy to Applications directory
cp -R "$APP_FILE" /Applications/

# Unmount the DMG
hdiutil detach "/tmp/ax-studio-mount"

# Determine app name and executable path
APP_NAME=$(basename "$APP_FILE")

echo "App name: $APP_NAME"

# First, check what's actually in the MacOS folder
echo "Contents of MacOS folder:"
ls -la "/Applications/$APP_NAME/Contents/MacOS/"

# Find all executable files in MacOS folder
echo "Looking for executable files..."
find "/Applications/$APP_NAME/Contents/MacOS/" -type f -perm +111 -ls

# Try to find the main executable - it's usually the one with the same name as the app (without .app)
APP_BASE_NAME=$(basename "$APP_NAME" .app)
POTENTIAL_EXECUTABLES=(
    "/Applications/$APP_NAME/Contents/MacOS/$APP_BASE_NAME"
    "/Applications/$APP_NAME/Contents/MacOS/Ax-Studio"
    "/Applications/$APP_NAME/Contents/MacOS/Ax-Studio-nightly"
)

APP_PATH=""
for potential_exec in "${POTENTIAL_EXECUTABLES[@]}"; do
    echo "Checking: $potential_exec"
    if [ -f "$potential_exec" ] && [ -x "$potential_exec" ]; then
        APP_PATH="$potential_exec"
        echo "Found executable: $APP_PATH"
        break
    fi
done

# If still not found, get any executable file
if [ -z "$APP_PATH" ]; then
    echo "No predefined executable found, searching for any executable..."
    APP_PATH=$(find "/Applications/$APP_NAME/Contents/MacOS/" -type f -perm +111 | head -1)
fi

if [ -z "$APP_PATH" ]; then
    echo "[FAILED] No executable found in MacOS folder"
    ls -la "/Applications/$APP_NAME/Contents/MacOS/"
    exit 1
fi

PROCESS_NAME=$(basename "$APP_PATH")

echo "App installed at: /Applications/$APP_NAME"
echo "Executable path: $APP_PATH"
echo "Process name: $PROCESS_NAME"

# Export for test step
echo "AX_STUDIO_APP_PATH=$APP_PATH" >> $GITHUB_ENV
echo "PROCESS_NAME=$PROCESS_NAME" >> $GITHUB_ENV

echo "[INFO] Waiting for Ax-Studio app first initialization (120 seconds)..."
echo "This allows Ax-Studio to complete its initial setup and configuration"
sleep 120
echo "[SUCCESS] Initialization wait completed"

# Verify installation
if [ -f "$APP_PATH" ]; then
    echo "[SUCCESS] Ax-Studio app installed successfully"
    ls -la "/Applications/$APP_NAME"
else
    echo "[FAILED] Ax-Studio app installation failed - executable not found"
    exit 1
fi
