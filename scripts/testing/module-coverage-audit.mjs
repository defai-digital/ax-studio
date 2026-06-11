#!/usr/bin/env node
/**
 * module-coverage-audit.mjs
 *
 * Reads the Vitest v8 coverage summary (coverage/coverage-summary.json) and
 * produces a per-module breakdown JSON file consumed by module-coverage-gate.mjs.
 *
 * Usage:
 *   node scripts/testing/module-coverage-audit.mjs --out-dir report/testing
 */

import fs from 'fs'
import path from 'path'
import { parseArgs } from 'util'

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    'out-dir': { type: 'string', default: 'report/testing' },
    'coverage-file': { type: 'string', default: 'coverage/coverage-summary.json' },
  },
})

const outDir = values['out-dir']
const coverageFile = values['coverage-file']

if (!fs.existsSync(coverageFile)) {
  console.error(`Coverage file not found: ${coverageFile}`)
  console.error('Run "yarn test:coverage" first to generate coverage data.')
  process.exit(1)
}

const summary = JSON.parse(fs.readFileSync(coverageFile, 'utf8'))

// Module mapping: key = module name, value = path substring to match
const MODULE_PATTERNS = {
  'stores':        'src/stores',
  'hooks':         'src/hooks',
  'services':      'src/services',
  'lib':           'src/lib',
  'utils':         'src/utils',
  'components/ui': 'src/components/ui',
  'containers':    'src/containers',
  'providers':     'src/providers',
  'routes':        'src/routes',
}

/**
 * Accumulate raw coverage numbers for each module.
 */
const moduleAccum = {}

for (const [moduleName] of Object.entries(MODULE_PATTERNS)) {
  moduleAccum[moduleName] = {
    lines:     { covered: 0, total: 0 },
    functions: { covered: 0, total: 0 },
    branches:  { covered: 0, total: 0 },
    statements:{ covered: 0, total: 0 },
    files: [],
  }
}

for (const [filePath, data] of Object.entries(summary)) {
  if (filePath === 'total') continue

  // Normalize path separators
  const normalized = filePath.replace(/\\/g, '/')

  // Sort by pattern length descending so more specific patterns match first
  // (e.g. 'src/components/ui' before 'src/components')
  const sortedPatterns = Object.entries(MODULE_PATTERNS)
    .sort(([, a], [, b]) => b.length - a.length)

  for (const [moduleName, pattern] of sortedPatterns) {
    if (normalized.includes(pattern)) {
      const acc = moduleAccum[moduleName]

      // Only count towards the most specific matching module
      // (components/ui is more specific than components, for example)
      acc.lines.covered     += data.lines.covered
      acc.lines.total       += data.lines.total
      acc.functions.covered += data.functions.covered
      acc.functions.total   += data.functions.total
      acc.branches.covered  += data.branches.covered
      acc.branches.total    += data.branches.total
      acc.statements.covered += data.statements.covered
      acc.statements.total  += data.statements.total
      acc.files.push(normalized)
      break
    }
  }
}

/**
 * Build final audit output.
 */
const pct = (covered, total) => (total === 0 ? 100 : Math.round((covered / total) * 1000) / 10)

const audit = {
  generatedAt: new Date().toISOString(),
  total: {
    lines:      { pct: summary.total?.lines?.pct ?? 0, covered: summary.total?.lines?.covered ?? 0, total: summary.total?.lines?.total ?? 0 },
    functions:  { pct: summary.total?.functions?.pct ?? 0 },
    branches:   { pct: summary.total?.branches?.pct ?? 0 },
    statements: { pct: summary.total?.statements?.pct ?? 0 },
  },
  modules: {},
}

for (const [moduleName, acc] of Object.entries(moduleAccum)) {
  audit.modules[moduleName] = {
    fileCount:  acc.files.length,
    lines:      { pct: pct(acc.lines.covered, acc.lines.total),         covered: acc.lines.covered,     total: acc.lines.total },
    functions:  { pct: pct(acc.functions.covered, acc.functions.total), covered: acc.functions.covered, total: acc.functions.total },
    branches:   { pct: pct(acc.branches.covered, acc.branches.total) },
    statements: { pct: pct(acc.statements.covered, acc.statements.total) },
  }
}

fs.mkdirSync(outDir, { recursive: true })
const outFile = path.join(outDir, 'module-coverage-audit.json')
fs.writeFileSync(outFile, JSON.stringify(audit, null, 2))

// Print summary table
console.log('\nModule Coverage Audit')
console.log('─'.repeat(60))
const col = (s, w) => String(s).padEnd(w)
const pctCol = (value) =>
  typeof value === 'number'
    ? `${value.toFixed(1)}%`.padStart(8)
    : String(value).padStart(8)
console.log(col('Module', 22) + pctCol('Lines') + pctCol('Funcs') + pctCol('Branches') + '  Files')
console.log('─'.repeat(60))
for (const [mod, data] of Object.entries(audit.modules)) {
  console.log(
    col(mod, 22) +
    pctCol(data.lines.pct) +
    pctCol(data.functions.pct) +
    pctCol(data.branches.pct) +
    '  ' + data.fileCount
  )
}
console.log('─'.repeat(60))
console.log(`\nAudit written to ${outFile}`)
