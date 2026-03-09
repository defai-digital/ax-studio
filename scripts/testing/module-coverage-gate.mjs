#!/usr/bin/env node
/**
 * module-coverage-gate.mjs
 *
 * Compares per-module coverage from the audit JSON against thresholds.
 * Exits with code 1 (blocking) in "strict" mode, or 0 with warnings in "advisory" mode.
 *
 * Usage:
 *   node scripts/testing/module-coverage-gate.mjs \
 *     --audit report/testing/module-coverage-audit.json \
 *     --thresholds testing/module-thresholds.json \
 *     --mode advisory
 */

import fs from 'fs'
import { parseArgs } from 'util'

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    audit:      { type: 'string', default: 'report/testing/module-coverage-audit.json' },
    thresholds: { type: 'string', default: 'testing/module-thresholds.json' },
    mode:       { type: 'string', default: 'advisory' }, // advisory | strict
  },
})

const mode = values.mode

for (const file of [values.audit, values.thresholds]) {
  if (!fs.existsSync(file)) {
    console.error(`File not found: ${file}`)
    process.exit(1)
  }
}

const audit      = JSON.parse(fs.readFileSync(values.audit, 'utf8'))
const thresholds = JSON.parse(fs.readFileSync(values.thresholds, 'utf8'))

const METRICS = ['lines', 'functions']

const failures = []
const warnings = []

console.log('\nModule Coverage Gate')
console.log(`Mode: ${mode}`)
console.log('─'.repeat(70))

for (const [moduleName, limits] of Object.entries(thresholds.modules)) {
  const data = audit.modules[moduleName]

  if (!data) {
    warnings.push(`  ${moduleName}: no coverage data found (module may have no source files yet)`)
    continue
  }

  for (const metric of METRICS) {
    const threshold = limits[metric]
    if (threshold == null) continue

    const actual = data[metric]?.pct ?? 0

    const status = actual >= threshold ? 'PASS' : 'FAIL'
    const icon   = actual >= threshold ? '✓' : '✗'

    const row = `  ${icon} ${moduleName.padEnd(20)} ${metric.padEnd(12)} ${String(actual.toFixed(1) + '%').padStart(7)} / ${String(threshold + '%').padStart(6)}  [${status}]`
    console.log(row)

    if (actual < threshold) {
      failures.push({ moduleName, metric, actual, threshold })
    }
  }
}

console.log('─'.repeat(70))

if (warnings.length > 0) {
  console.log('\nWarnings:')
  warnings.forEach((w) => console.warn(w))
}

if (failures.length > 0) {
  console.log(`\n${failures.length} module(s) below threshold:`)
  for (const f of failures) {
    console.log(`  - ${f.moduleName} ${f.metric}: ${f.actual.toFixed(1)}% (threshold: ${f.threshold}%)`)
  }

  if (mode === 'strict') {
    console.error('\nCoverage gate FAILED (strict mode). Fix coverage before merging.')
    process.exit(1)
  } else {
    console.warn('\nCoverage gate ADVISORY: thresholds not met, but not blocking (advisory mode).')
    process.exit(0)
  }
} else {
  console.log('\nAll modules meet their coverage thresholds.')
  process.exit(0)
}
