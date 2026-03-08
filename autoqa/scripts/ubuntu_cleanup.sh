#!/bin/bash
# Ubuntu cleanup script for Ax-Studio app

echo "Cleaning existing Ax-Studio installations..."

# Remove Ax-Studio data folders (both regular and nightly)
rm -rf ~/.config/Ax-Studio
rm -rf ~/.config/Ax-Studio-nightly
rm -rf ~/.local/share/Ax-Studio
rm -rf ~/.local/share/Ax-Studio-nightly
rm -rf ~/.cache/ax-studio
rm -rf ~/.cache/ax-studio-nightly
rm -rf ~/.local/share/ax-studio-nightly.ai.app
rm -rf ~/.local/share/ai.axstudio.app

# Kill any running Ax-Studio processes (both regular and nightly)
pkill -f "Ax-Studio" || true
pkill -f "ax-studio" || true
pkill -f "Ax-Studio-nightly" || true
pkill -f "ax-studio-nightly" || true

echo "Ax-Studio cleanup completed"
