#!/usr/bin/env bash
# run-quality-gates.sh
# Runs the full test + coverage + module gate pipeline.
# Used by: make test-quality, CI workflow (ax-studio-linter-and-test.yml)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

VITEST_BIN="$ROOT/node_modules/.bin/vitest"

if [[ ! -x "$VITEST_BIN" ]]; then
  echo "Vitest binary not found at $VITEST_BIN"
  echo "Install project dependencies before running quality gates."
  exit 1
fi

echo "=== AX Studio Quality Gates ==="
echo ""

# 1. Run tests with coverage
echo "--- Step 1: Run tests with coverage ---"
"$VITEST_BIN" run --coverage

# 2. Generate per-module audit from coverage output
echo ""
echo "--- Step 2: Module coverage audit ---"
node scripts/testing/module-coverage-audit.mjs --out-dir report/testing

# 3. Enforce thresholds
echo ""
echo "--- Step 3: Coverage gate ---"
MODE="${COVERAGE_GATE_MODE:-blocking}"
node scripts/testing/module-coverage-gate.mjs \
  --audit report/testing/module-coverage-audit.json \
  --thresholds scripts/testing/module-thresholds.json \
  --mode "$MODE"

echo ""
echo "=== Quality gates complete ==="
