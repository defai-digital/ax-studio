# AX Studio AutoQA

Automated quality-assurance tooling for AX Studio end-to-end workflows.

This area contains Python-based test runners, screen recording helpers, and optional ReportPortal integration for longer-running QA flows.

## What Lives Here

- `main.py` test runner entry point
- `test_runner.py` orchestration logic
- `screen_recorder.py` recording support
- `reportportal_handler.py` ReportPortal integration
- `utils.py` platform and process helpers
- `tests/` text-based scenario definitions

## Prerequisites

- Python 3.8+
- AX Studio application available locally
- required Python dependencies from `requirements.txt`

Some scenarios may require additional environment-specific dependencies. Check the specific test flow before assuming the entire suite is portable.

## Setup

From `autoqa/`:

```bash
pip install -r requirements.txt
```

## Common Commands

```bash
python main.py
python main.py --help
python main.py --tests-dir tests
python main.py --skip-server-start
```

## Configuration Notes

Configuration is driven by command-line arguments and environment variables. If you document or change defaults here, keep them aligned with the actual runner implementation instead of environment-specific local values.

## Writing Tests

Test cases are text files that describe the scenario for the runner to execute.

Example:

```text
Open the AX Studio application.
Switch the model to "GPT-4o".
Send a message: "What is the capital of France?".
Verify that the response mentions "Paris".
```

## Documentation Scope

This README is intentionally operational. If you need team-specific infrastructure defaults or private endpoints, keep that in internal-only documentation rather than this shared repository guide.
