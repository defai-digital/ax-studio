#!/bin/bash
# Ubuntu cleanup script for Ax-Fabric app

echo "Cleaning existing Ax-Fabric installations..."

# Remove Ax-Fabric data folders (both regular and nightly)
rm -rf ~/.config/Ax-Fabric
rm -rf ~/.config/Ax-Fabric-nightly
rm -rf ~/.local/share/Ax-Fabric
rm -rf ~/.local/share/Ax-Fabric-nightly
rm -rf ~/.cache/ax-fabric
rm -rf ~/.cache/ax-fabric-nightly
rm -rf ~/.local/share/ax-fabric-nightly.ai.app
rm -rf ~/.local/share/ai.axfabric.app

# Kill any running Ax-Fabric processes (both regular and nightly)
pkill -f "Ax-Fabric" || true
pkill -f "ax-fabric" || true
pkill -f "Ax-Fabric-nightly" || true
pkill -f "ax-fabric-nightly" || true

echo "Ax-Fabric cleanup completed"
