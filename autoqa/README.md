# Ax-Fabric Automated Quality Assurance (AutoQA)

A Python-based framework for automated end-to-end (E2E) testing of the Ax-Fabric application. This tool automates the interaction with the application, captures screen recordings, and reports results to [ReportPortal](https://reportportal.io/).

## Features

- **Application Automation**: Automatically launches, monitors, and stops Ax-Fabric.
- **Screen Recording**: Captures high-quality video of each test case execution.
- **Trajectory Capture**: Records the AI agent's decision-making steps (trajectories) for later analysis.
- **Reporting**: Full integration with ReportPortal for test management, analytics, and history.
- **Loop Prevention**: Configurable turn limits to prevent infinite agent loops.
- **Mock Services**: Includes a `computer-server` mock for testing platform integration.

## Getting Started

### Prerequisites
- Python 3.9+
- The Ax-Fabric application installed on your system.
- FFmpeg installed (required for screen recording).

### Installation
```bash
# From the root autoqa/ directory
pip install -r requirements.txt
```

### Quick Run (Local Mode)
```bash
# Run all tests without reporting
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

- **Recording Fails**: Ensure `ffmpeg` is in your system `PATH`.
- **App Not Found**: Manually specify the path using `--app-path`.
- **Timeouts**: If tests are taking too long, increase `--max-turns`.
