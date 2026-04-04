import { describe, expect, it } from 'vitest'
import { AssistantEvent } from './assistantEvent'

describe('AssistantEvent', () => {
  it('exports the assistants update event name', () => {
    expect(AssistantEvent.OnAssistantsUpdate).toBe('OnAssistantsUpdate')
  })

  it('only exposes the expected runtime event values', () => {
    expect(Object.values(AssistantEvent)).toEqual(['OnAssistantsUpdate'])
  })
})
