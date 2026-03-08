#!/bin/bash
# macOS cleanup script for Ax-Studio app

echo "Cleaning existing Ax-Studio installations..."

# Kill any running Ax-Studio processes (both regular and nightly)
pkill -f "Ax-Studio" || true
pkill -f "ax-studio" || true
pkill -f "Ax-Studio-nightly" || true
pkill -f "ax-studio-nightly" || true

# Remove Ax-Studio app directories
rm -rf /Applications/Ax-Studio.app
rm -rf /Applications/Ax-Studio-nightly.app
rm -rf ~/Applications/Ax-Studio.app
rm -rf ~/Applications/Ax-Studio-nightly.app

# Remove Ax-Studio data folders (both regular and nightly)
rm -rf ~/Library/Application\ Support/Ax-Studio
rm -rf ~/Library/Application\ Support/Ax-Studio-nightly
rm -rf ~/Library/Application\ Support/ai.axstudio.app
rm -rf ~/Library/Application\ Support/ax-studio-nightly.ai.app
rm -rf ~/Library/Preferences/ax-studio.*
rm -rf ~/Library/Preferences/ax-studio-nightly.*
rm -rf ~/Library/Caches/ax-studio.*
rm -rf ~/Library/Caches/ax-studio-nightly.*
rm -rf ~/Library/Caches/ax-studio.ai.app
rm -rf ~/Library/Caches/ax-studio-nightly.ai.app
rm -rf ~/Library/WebKit/ai.axstudio.app
rm -rf ~/Library/WebKit/ax-studio-nightly.ai.app
rm -rf ~/Library/Saved\ Application\ State/ai.axstudio.app
rm -rf ~/Library/Saved\ Application\ State/ax-studio-nightly.ai.app

echo "Ax-Studio cleanup completed"
