#!/usr/bin/env bash
# run-quality-gates.sh
# Runs the full test + coverage + module gate pipeline.
# Used by: make test-quality, CI workflow (ax-studio-linter-and-test.yml)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

echo "=== AX Studio Quality Gates ==="
echo ""

# 1. Run tests with coverage
echo "--- Step 1: Run tests with coverage ---"
yarn test:coverage

# 2. Generate per-module audit from coverage output
echo ""
echo "--- Step 2: Module coverage audit ---"
node scripts/testing/module-coverage-audit.mjs --out-dir report/testing

# 3. Enforce thresholds
echo ""
echo "--- Step 3: Coverage gate ---"
MODE="${COVERAGE_GATE_MODE:-advisory}"
node scripts/testing/module-coverage-gate.mjs \
  --audit report/testing/module-coverage-audit.json \
  --thresholds testing/module-thresholds.json \
  --mode "$MODE"

echo ""
echo "=== Quality gates complete ==="
