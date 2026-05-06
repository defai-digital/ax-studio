#!/usr/bin/env node
/**
 * module-coverage-gate.mjs
 *
 * Compares per-module coverage from the audit JSON against thresholds.
 * Exits with code 1 in "strict"/"blocking" mode, or 0 with warnings in
 * "advisory" mode.
 *
 * Usage:
 *   node scripts/testing/module-coverage-gate.mjs \
 *     --audit report/testing/module-coverage-audit.json \
 *     --thresholds scripts/testing/module-thresholds.json \
 *     --mode advisory
 */

import fs from 'fs'
import { pathToFileURL } from 'url'
import { parseArgs } from 'util'

const METRICS = ['lines', 'functions']
const BLOCKING_MODES = new Set(['strict', 'blocking'])
const ALLOWED_MODES = new Set(['advisory', ...BLOCKING_MODES])

export function normalizeGateMode(mode = 'advisory') {
  if (!ALLOWED_MODES.has(mode)) {
    throw new Error(
      `Unsupported coverage gate mode "${mode}". Use advisory, strict, or blocking.`
    )
  }

  return BLOCKING_MODES.has(mode) ? 'blocking' : 'advisory'
}

export function evaluateCoverageGate(audit, thresholds) {
  const failures = []
  const warnings = []
  const rows = []

  for (const [moduleName, limits] of Object.entries(thresholds.modules)) {
    const data = audit.modules[moduleName]

    if (!data) {
      warnings.push(
        `  ${moduleName}: no coverage data found (module may have no source files yet)`
      )
      continue
    }

    for (const metric of METRICS) {
      const threshold = limits[metric]
      if (threshold == null) continue

      const actual = data[metric]?.pct ?? 0

      const status = actual >= threshold ? 'PASS' : 'FAIL'
      const icon = actual >= threshold ? '✓' : '✗'

      rows.push({
        moduleName,
        metric,
        actual,
        threshold,
        status,
        icon,
      })

      if (actual < threshold) {
        failures.push({ moduleName, metric, actual, threshold })
      }
    }
  }

  return { failures, warnings, rows }
}

export function formatCoverageGateReport({ mode, rows, warnings, failures }) {
  const normalizedMode = normalizeGateMode(mode)
  const output = [
    '',
    'Module Coverage Gate',
    `Mode: ${normalizedMode}`,
    '─'.repeat(70),
  ]

  for (const row of rows) {
    output.push(
      `  ${row.icon} ${row.moduleName.padEnd(20)} ${row.metric.padEnd(12)} ${String(row.actual.toFixed(1) + '%').padStart(7)} / ${String(row.threshold + '%').padStart(6)}  [${row.status}]`
    )
  }

  output.push('─'.repeat(70))

  if (warnings.length > 0) {
    output.push('', 'Warnings:', ...warnings)
  }

  if (failures.length > 0) {
    output.push('', `${failures.length} module(s) below threshold:`)
    for (const f of failures) {
      output.push(
        `  - ${f.moduleName} ${f.metric}: ${f.actual.toFixed(1)}% (threshold: ${f.threshold}%)`
      )
    }

    if (normalizedMode === 'blocking') {
      output.push('', 'Coverage gate FAILED (blocking mode). Fix coverage before merging.')
    } else {
      output.push(
        '',
        'Coverage gate ADVISORY: thresholds not met, but not blocking (advisory mode).'
      )
    }
  } else {
    output.push('', 'All modules meet their coverage thresholds.')
  }

  return output.join('\n')
}

export function runCoverageGate({
  audit,
  thresholds,
  mode = 'advisory',
  stdout = console.log,
  stderr = console.error,
} = {}) {
  const normalizedMode = normalizeGateMode(mode)
  const result = evaluateCoverageGate(audit, thresholds)
  const report = formatCoverageGateReport({ ...result, mode: normalizedMode })

  if (result.failures.length > 0 && normalizedMode === 'blocking') {
    stderr(report)
    return 1
  }

  stdout(report)
  return 0
}

function parseCliArgs(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      audit: {
        type: 'string',
        default: 'report/testing/module-coverage-audit.json',
      },
      thresholds: {
        type: 'string',
        default: 'scripts/testing/module-thresholds.json',
      },
      mode: { type: 'string', default: 'advisory' },
    },
  })

  return values
}

function runCli(argv = process.argv.slice(2)) {
  let values

  try {
    values = parseCliArgs(argv)
    normalizeGateMode(values.mode)
  } catch (error) {
    console.error(error.message)
    return 1
  }

  for (const file of [values.audit, values.thresholds]) {
    if (!fs.existsSync(file)) {
      console.error(`File not found: ${file}`)
      return 1
    }
  }

  const audit = JSON.parse(fs.readFileSync(values.audit, 'utf8'))
  const thresholds = JSON.parse(fs.readFileSync(values.thresholds, 'utf8'))

  return runCoverageGate({ audit, thresholds, mode: values.mode })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(runCli())
}
