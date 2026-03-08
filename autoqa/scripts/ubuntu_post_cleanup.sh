#!/bin/bash
# Ubuntu post-test cleanup script

IS_NIGHTLY="$1"

echo "Cleaning up after tests..."

# Kill any running Ax-Studio processes (both regular and nightly)
pkill -f "Ax-Studio" || true
pkill -f "ax-studio" || true
pkill -f "Ax-Studio-nightly" || true
pkill -f "ax-studio-nightly" || true

# Remove Ax-Studio data folders (both regular and nightly)
rm -rf ~/.config/Ax-Studio
rm -rf ~/.config/Ax-Studio-nightly
rm -rf ~/.local/share/Ax-Studio
rm -rf ~/.local/share/Ax-Studio-nightly
rm -rf ~/.cache/ax-studio
rm -rf ~/.cache/ax-studio-nightly
rm -rf ~/.local/share/ax-studio-nightly.ai.app
rm -rf ~/.local/share/ai.axstudio.app

# Try to uninstall Ax-Studio app
if [ "$IS_NIGHTLY" = "true" ]; then
    PACKAGE_NAME="ax-studio-nightly"
else
    PACKAGE_NAME="ax-studio"
fi

echo "Attempting to uninstall package: $PACKAGE_NAME"

if dpkg -l | grep -q "$PACKAGE_NAME"; then
    echo "Found package $PACKAGE_NAME, uninstalling..."
    sudo dpkg -r "$PACKAGE_NAME" || true
    sudo apt-get autoremove -y || true
else
    echo "Package $PACKAGE_NAME not found in dpkg list"
fi

# Clean up downloaded installer
rm -f "/tmp/ax-studio-installer.deb"

echo "Cleanup completed"
