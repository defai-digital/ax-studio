#!/bin/bash
# macOS cleanup script for Ax-Fabric app

echo "Cleaning existing Ax-Fabric installations..."

# Kill any running Ax-Fabric processes (both regular and nightly)
pkill -f "Ax-Fabric" || true
pkill -f "ax-fabric" || true
pkill -f "Ax-Fabric-nightly" || true
pkill -f "ax-fabric-nightly" || true

# Remove Ax-Fabric app directories
rm -rf /Applications/Ax-Fabric.app
rm -rf /Applications/Ax-Fabric-nightly.app
rm -rf ~/Applications/Ax-Fabric.app
rm -rf ~/Applications/Ax-Fabric-nightly.app

# Remove Ax-Fabric data folders (both regular and nightly)
rm -rf ~/Library/Application\ Support/Ax-Fabric
rm -rf ~/Library/Application\ Support/Ax-Fabric-nightly
rm -rf ~/Library/Application\ Support/ai.axfabric.app
rm -rf ~/Library/Application\ Support/ax-fabric-nightly.ai.app
rm -rf ~/Library/Preferences/ax-fabric.*
rm -rf ~/Library/Preferences/ax-fabric-nightly.*
rm -rf ~/Library/Caches/ax-fabric.*
rm -rf ~/Library/Caches/ax-fabric-nightly.*
rm -rf ~/Library/Caches/ax-fabric.ai.app
rm -rf ~/Library/Caches/ax-fabric-nightly.ai.app
rm -rf ~/Library/WebKit/ai.axfabric.app
rm -rf ~/Library/WebKit/ax-fabric-nightly.ai.app
rm -rf ~/Library/Saved\ Application\ State/ai.axfabric.app
rm -rf ~/Library/Saved\ Application\ State/ax-fabric-nightly.ai.app

echo "Ax-Fabric cleanup completed"
