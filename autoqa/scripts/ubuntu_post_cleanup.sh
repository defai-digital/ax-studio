#!/bin/bash
# Ubuntu post-test cleanup script

IS_NIGHTLY="$1"

echo "Cleaning up after tests..."

# Kill any running Ax-Fabric processes (both regular and nightly)
pkill -f "Ax-Fabric" || true
pkill -f "ax-fabric" || true
pkill -f "Ax-Fabric-nightly" || true
pkill -f "ax-fabric-nightly" || true

# Remove Ax-Fabric data folders (both regular and nightly)
rm -rf ~/.config/Ax-Fabric
rm -rf ~/.config/Ax-Fabric-nightly
rm -rf ~/.local/share/Ax-Fabric
rm -rf ~/.local/share/Ax-Fabric-nightly
rm -rf ~/.cache/ax-fabric
rm -rf ~/.cache/ax-fabric-nightly
rm -rf ~/.local/share/ax-fabric-nightly.ai.app
rm -rf ~/.local/share/ai.axfabric.app

# Try to uninstall Ax-Fabric app
if [ "$IS_NIGHTLY" = "true" ]; then
    PACKAGE_NAME="ax-fabric-nightly"
else
    PACKAGE_NAME="ax-fabric"
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
rm -f "/tmp/ax-fabric-installer.deb"

echo "Cleanup completed"
