# Ax-Fabric Automated Quality Assurance (AutoQA)

🚀 An automated end-to-end test runner for Ax-Studio application with ReportPortal integration, screen recording, and comprehensive test monitoring.

## Features

- ✅ **Automated Ax-Studio App Testing**: Automatically starts/stops Ax-Studio application
- 🖥️ **Auto Computer Server**: Automatically starts computer server in background
- 📹 **Screen Recording**: Records test execution for debugging
- 📊 **ReportPortal Integration**: Optional test results upload to ReportPortal
- 🔄 **Turn Monitoring**: Prevents infinite loops with configurable turn limits
- 🎯 **Flexible Configuration**: Command-line arguments and environment variables
- 🌐 **Cross-platform**: Windows, macOS, and Linux support
- 📁 **Test Discovery**: Automatically scans test files from directory

## Prerequisites

- Python 3.8+
- Ax-Studio application installed
- Windows Sandbox (for computer provider)
- Computer server package installed
- Required Python packages (see requirements.txt)

## Installation

1. Clone the repository:

```bash
# From the root autoqa/ directory
pip install -r requirements.txt
```

3. Ensure Ax-Studio application is installed in one of the default locations:
   - Windows: `%LOCALAPPDATA%\Programs\ax-studio\Ax-Studio.exe`
   - macOS: `~/Applications/Ax-Studio.app/Contents/MacOS/Ax-Studio`
   - Linux: `ax-studio` (in PATH)

## Quick Start

### Local Development (No ReportPortal)

```bash
# Run all tests in ./tests directory (auto-starts computer server)
python main.py

# Run with custom test directory
python main.py --tests-dir "my_tests"

# Run with custom Ax-Studio app path
python main.py --app-path "C:/Custom/Path/Ax-Studio.exe"

# Skip auto computer server start (if already running)
python main.py --skip-server-start
```

### With ReportPortal Integration

```bash
# Enable ReportPortal with token
python main.py --enable-reportportal --rp-token "YOUR_API_TOKEN"

# Full ReportPortal configuration
python main.py \
  --enable-reportportal \
  --rp-endpoint "https://reportportal.example.com" \
  --rp-project "my_project" \
  --rp-token "YOUR_API_TOKEN"
```

## Configuration

### Command Line Arguments

| Argument                | Environment Variable  | Default                         | Description                                       |
| ----------------------- | --------------------- | ------------------------------- | ------------------------------------------------- |
| **Computer Server**     |
| `--skip-server-start`   | `SKIP_SERVER_START`   | `false`                         | Skip automatic computer server startup            |
| **ReportPortal**        |
| `--enable-reportportal` | `ENABLE_REPORTPORTAL` | `false`                         | Enable ReportPortal integration                   |
| `--rp-endpoint`         | `RP_ENDPOINT`         | `https://reportportal.axstudio.ai` | ReportPortal endpoint URL                         |
| `--rp-project`          | `RP_PROJECT`          | `default_personal`              | ReportPortal project name                         |
| `--rp-token`            | `RP_TOKEN`            | -                               | ReportPortal API token (required when RP enabled) |
| **Ax-Studio Application**     |
| `--app-path`        | `AX_STUDIO_APP_PATH`        | _auto-detected_                 | Path to Ax-Studio application executable                |
| `--process-name`    | `AX_STUDIO_PROCESS_NAME`    | `Ax-Studio.exe`                       | Ax-Studio process name for monitoring                   |
| **Model Configuration** |
| `--model-name`          | `MODEL_NAME`          | `ByteDance-Seed/UI-TARS-1.5-7B` | AI model name                                     |
| `--model-base-url`      | `MODEL_BASE_URL`      | `http://10.200.108.58:1234/v1`  | Model API endpoint                                |
| `--model-provider`      | `MODEL_PROVIDER`      | `oaicompat`                     | Model provider type                               |
| `--model-loop`          | `MODEL_LOOP`          | `uitars`                        | Agent loop type                                   |
| **Test Execution**      |
| `--max-turns`           | `MAX_TURNS`           | `30`                            | Maximum turns per test                            |
| `--tests-dir`           | `TESTS_DIR`           | `tests`                         | Directory containing test files                   |
| `--delay-between-tests` | `DELAY_BETWEEN_TESTS` | `3`                             | Delay between tests (seconds)                     |

### Environment Variables

Create a `.env` file or set environment variables:

```bash
# Computer Server
SKIP_SERVER_START=false

# ReportPortal Configuration
ENABLE_REPORTPORTAL=true
RP_ENDPOINT=https://reportportal.example.com
RP_PROJECT=my_project
RP_TOKEN=your_secret_token

# Ax-Studio Application
AX_STUDIO_APP_PATH=C:\Custom\Path\Ax-Studio.exe
AX_STUDIO_PROCESS_NAME=Ax-Studio.exe

# Model Configuration
MODEL_NAME=gpt-4
MODEL_BASE_URL=https://api.openai.com/v1
MODEL_PROVIDER=openai
MODEL_LOOP=uitars

# Test Settings
MAX_TURNS=50
TESTS_DIR=e2e_tests
DELAY_BETWEEN_TESTS=5
```

## Test Structure

### Test Files

- Test files should be `.txt` files containing test prompts
- Place test files in the `tests/` directory (or custom directory)
- Support nested directories for organization

Example test file (`tests/basic/login_test.txt`):

```
Test the login functionality of Ax-Studio application.
Navigate to login screen, enter valid credentials, and verify successful login.
```

### Directory Structure

```
autoqa/
├── main.py                 # Main test runner
├── utils.py               # Ax-Studio app utilities
├── test_runner.py         # Test execution logic
├── screen_recorder.py     # Screen recording functionality
├── reportportal_handler.py # ReportPortal integration
├── tests/                 # Test files directory
│   ├── basic/
│   │   ├── login_test.txt
│   │   └── navigation_test.txt
│   └── advanced/
│       └── complex_workflow.txt
├── recordings/            # Screen recordings (auto-created)
├── trajectories/          # Agent trajectories (auto-created)
└── README.md
```

## Usage Examples

### Basic Usage

```bash
# Run all tests locally (auto-starts computer server)
python main.py

# Get help
python main.py --help

# Run without auto-starting computer server
python main.py --skip-server-start
```

### Advanced Usage

```bash
# Custom configuration
python main.py \
  --tests-dir "integration_tests" \
  --max-turns 40 \
  --delay-between-tests 10 \
  --model-name "gpt-4"

# Environment + Arguments
ENABLE_REPORTPORTAL=true RP_TOKEN=secret python main.py --max-turns 50

# Different model provider
python main.py \
  --model-provider "openai" \
  --model-name "gpt-4" \
  --model-base-url "https://api.openai.com/v1"

# External computer server (skip auto-start)
SKIP_SERVER_START=true python main.py
```

### CI/CD Usage

```bash
# GitHub Actions / CI environment
ENABLE_REPORTPORTAL=true \
RP_TOKEN=${{ secrets.RP_TOKEN }} \
MODEL_NAME=production-model \
MAX_TURNS=40 \
SKIP_SERVER_START=false \
python main.py
```

### Advanced Run (Reporting Mode)
```bash
# Run with ReportPortal reporting enabled
export RP_TOKEN="your-token"
python main.py --enable-reportportal --rp-project "my_project"
```

## Writing New Test Cases

Test cases are simple `.txt` files containing instructions for the AI agent to follow. Place these files in the `tests/` directory.

### Example Test File (`tests/chat/simple-ask.txt`)
```text
Open the Ax-Fabric application.
Switch the model to "GPT-4o".
Send a message: "What is the capital of France?".
Verify that the response mentions "Paris".
```

### Organization
Tests can be nested in directories (e.g., `tests/ui/`, `tests/inference/`). The runner recursively searches for `.txt` files in the specified directory (`--tests-dir`).

## Project Structure

- **`main.py`**: Entry point for the test runner.
- **`test_runner.py`**: Core logic for orchestrating test execution.
- **`screen_recorder.py`**: Handles FFmpeg recording processes.
- **`reportportal_handler.py`**: Manages communication with the ReportPortal API.
- **`utils.py`**: Helper functions for platform-specific path resolution and process management.
- **`tests/`**: Directory for test definitions (agent prompts).
- **`recordings/`**: Output directory for generated `.mp4` files (auto-created).
- **`trajectories/`**: Output directory for agent step logs (auto-created).

## Configuration Reference

| Argument | Description | Default |
| :--- | :--- | :--- |
| `--tests-dir` | Directory to search for test files. | `tests` |
| `--max-turns` | Maximum number of turns an agent can take. | `30` |
| `--app-path` | Path to the Ax-Fabric executable. | _auto-detected_ |
| `--model-name` | The model to use for the AI agent. | `gpt-4o` |
| `--enable-reportportal` | Enable ReportPortal reporting. | `false` |

## Troubleshooting

### Common Issues

1. **Computer server startup failed**:

   ```bash
   # Install required dependencies
   pip install computer_server

   # Check if computer_server is available
   python -c "import computer_server; print('OK')"

   # Use manual server if auto-start fails
   python main.py --skip-server-start
   ```

2. **Ax-Studio app not found**:

   ```bash
   # Specify custom path
   python main.py --app-path "D:/Apps/Ax-Studio/Ax-Studio.exe"
   ```

3. **Windows dependencies missing**:

   ```bash
   # Install Windows-specific packages
   pip install pywin32 psutil
   ```

4. **ReportPortal connection failed**:

   - Verify endpoint URL and token
   - Check network connectivity
   - Ensure project exists

5. **Screen recording issues**:

   - Check disk space in `recordings/` directory
   - Verify screen recording permissions

6. **Test timeouts**:
   ```bash
   # Increase turn limit
   python main.py --max-turns 50
   ```

### Debug Mode

Enable detailed logging by modifying the logging level in `main.py`:

```python
logging.basicConfig(level=logging.DEBUG)
```
