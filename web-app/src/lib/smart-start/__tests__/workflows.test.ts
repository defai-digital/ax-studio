import { describe, expect, it } from 'vitest'

import { SMART_START_WORKFLOWS } from '../workflows'

describe('SMART_START_WORKFLOWS', () => {
  it('defines the expected workflow catalog', () => {
    expect(SMART_START_WORKFLOWS.map((workflow) => workflow.id)).toEqual([
      'research',
      'write',
      'analyze',
      'compare',
      'extract',
      'translate',
    ])
    expect(
      SMART_START_WORKFLOWS.every((workflow) =>
        workflow.fields.some((field) => field.required),
      ),
    ).toBe(true)
  })

  it('builds prompts for each workflow using supplied values', () => {
    const values = {
      topic: 'AX Studio stability',
      depth: 'deep',
      format: 'report',
      type: 'email',
      tone: 'professional',
      context: 'Send to the team',
      subject: 'coverage report',
      focus: 'risk areas',
      items: 'Option A vs Option B',
      criteria: 'cost and quality',
      source: 'Meeting notes',
      what: 'action items',
      content: 'Hello world',
      language: 'Spanish',
      style: 'localized',
    }

    const prompts = SMART_START_WORKFLOWS.map((workflow) =>
      workflow.buildPrompt(values),
    )

    expect(prompts[0]).toContain('comprehensive deep dive')
    expect(prompts[1]).toContain('Use a professional tone')
    expect(prompts[2]).toContain('Provide a full analysis')
    expect(prompts[3]).toContain('cost and quality')
    expect(prompts[4]).toContain('action items')
    expect(prompts[5]).toContain('Fully localize')
  })

  it('uses fallback prompt wording when optional fields are absent', () => {
    const byId = Object.fromEntries(
      SMART_START_WORKFLOWS.map((workflow) => [workflow.id, workflow]),
    )

    expect(byId.write.buildPrompt({ type: 'other', topic: 'Notes' })).toBe(
      'Write a document about: "Notes"',
    )
    expect(byId.analyze.buildPrompt({ subject: 'Data' })).toContain(
      'List the key insights',
    )
    expect(byId.extract.buildPrompt({ source: 'Raw text' })).toContain(
      'Extract the key points',
    )
    expect(byId.translate.buildPrompt({
      content: 'Hello',
      language: 'French',
      style: 'literal',
    })).toContain('Translate directly')
  })
})
