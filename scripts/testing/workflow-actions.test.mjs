import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const repoRoot = path.resolve(import.meta.dirname, '..', '..')
const workflowsDirectory = path.join(repoRoot, '.github', 'workflows')
const requiredFirstPartyActions = new Map([
  ['actions/checkout', 'v7'],
  ['actions/setup-node', 'v6'],
  ['actions/setup-go', 'v6'],
  ['actions/upload-artifact', 'v7'],
  ['actions/download-artifact', 'v8'],
])

function readWorkflows() {
  return fs.readdirSync(workflowsDirectory)
    .filter((fileName) => fileName.endsWith('.yml') || fileName.endsWith('.yaml'))
    .sort()
    .map((fileName) => ({
      fileName,
      content: fs.readFileSync(path.join(workflowsDirectory, fileName), 'utf8'),
    }))
}

describe('GitHub Actions dependency boundaries', () => {
  it('uses the supported Node 24 majors for first-party actions', () => {
    const observedActions = new Map(
      [...requiredFirstPartyActions.keys()].map((action) => [action, []]),
    )

    for (const workflow of readWorkflows()) {
      for (const match of workflow.content.matchAll(/uses:\s+(actions\/[\w-]+)@([^\s#]+)/g)) {
        const [, action, version] = match
        if (observedActions.has(action)) {
          observedActions.get(action).push({ fileName: workflow.fileName, version })
        }
      }
    }

    for (const [action, expectedVersion] of requiredFirstPartyActions) {
      const uses = observedActions.get(action)
      expect(uses.length, `${action} should remain covered by this policy`).toBeGreaterThan(0)
      expect(
        uses.filter(({ version }) => version !== expectedVersion),
        `${action} must use ${expectedVersion}`,
      ).toEqual([])
    }
  })

  it('does not execute actions from mutable branch refs', () => {
    const mutableReferences = []

    for (const workflow of readWorkflows()) {
      for (const match of workflow.content.matchAll(/uses:\s+([^\s#]+@(main|master|HEAD))\b/g)) {
        mutableReferences.push(`${workflow.fileName}: ${match[1]}`)
      }
    }

    expect(mutableReferences).toEqual([])
  })
})
