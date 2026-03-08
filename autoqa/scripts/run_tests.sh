#!/bin/bash
# Common test runner script

AX_STUDIO_APP_PATH="$1"
PROCESS_NAME="$2"
RP_TOKEN="$3"
PLATFORM="$4"

echo "Starting Auto QA Tests..."
echo "Platform: $PLATFORM"
echo "Ax-Studio app path: $AX_STUDIO_APP_PATH"
echo "Process name: $PROCESS_NAME"

# Platform-specific setup
if [ "$PLATFORM" = "ubuntu" ]; then
    # Get the current display session
    export DISPLAY=$(w -h | awk 'NR==1 {print $2}')
    echo "Display ID: $DISPLAY"

    # Verify display is working
    if [ -z "$DISPLAY" ]; then
        echo "No display session found, falling back to :0"
        export DISPLAY=:0
    fi

    echo "Using display: $DISPLAY"

    # Test display connection
    xdpyinfo -display $DISPLAY >/dev/null 2>&1 || {
        echo "Display $DISPLAY is not available"
        exit 1
    }

    # Make Ax-Studio executable if needed
    if [ -f "/usr/bin/Ax-Studio-nightly" ]; then
        sudo chmod +x /usr/bin/Ax-Studio-nightly
    fi
    if [ -f "/usr/bin/Ax-Studio" ]; then
        sudo chmod +x /usr/bin/Ax-Studio
    fi
fi

# macOS specific setup
if [ "$PLATFORM" = "macos" ]; then
    # Verify Ax-Studio app path
    if [ ! -f "$AX_STUDIO_APP_PATH" ]; then
        echo "❌ Ax-Studio app not found at: $AX_STUDIO_APP_PATH"
        echo "Available files in /Applications:"
        ls -la /Applications/ | grep -i "Ax-Studio" || echo "No Ax-Studio apps found"
        exit 1
    fi
fi

# Change to autoqa directory to ensure correct working directory
cd "$(dirname "$0")/.."
echo "Current working directory: $(pwd)"
echo "Contents of current directory:"
ls -la
echo "Contents of trajectories directory (if exists):"
ls -la trajectories/ 2>/dev/null || echo "trajectories directory not found"

# Run the main test with proper arguments
if [ -n "$AX_STUDIO_APP_PATH" ] && [ -n "$PROCESS_NAME" ]; then
    python main.py --enable-reportportal --rp-token "$RP_TOKEN" --app-path "$AX_STUDIO_APP_PATH" --process-name "$PROCESS_NAME"
elif [ -n "$AX_STUDIO_APP_PATH" ]; then
    python main.py --enable-reportportal --rp-token "$RP_TOKEN" --app-path "$AX_STUDIO_APP_PATH"
else
    python main.py --enable-reportportal --rp-token "$RP_TOKEN"
fi
