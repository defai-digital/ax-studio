import { describe, it, expect } from 'vitest'
import {
  selectVisibleMessages,
  getVersionInfoByMessageId,
} from '@/lib/messages/versions'

function msg(
  id: string,
  overrides: Partial<{ metadata: Record<string, unknown> }> = {}
): ThreadMessage {
  return {
    id,
    thread_id: 'thread-1',
    role: 'assistant',
    content: [],
    status: 'ready',
    created_at: 0,
    completed_at: 0,
    ...overrides,
  } as unknown as ThreadMessage
}

describe('selectVisibleMessages', () => {
  it('keeps ungrouped messages unconditionally', () => {
    const messages = [msg('a'), msg('b')]
    expect(selectVisibleMessages(messages)).toEqual(messages)
  })

  it('keeps only the active version within a group', () => {
    const messages = [
      msg('user-1'),
      msg('v1', { metadata: { versionGroupId: 'user-1', versionIndex: 1, isActiveVersion: false } }),
      msg('v2', { metadata: { versionGroupId: 'user-1', versionIndex: 2, isActiveVersion: true } }),
    ]
    const visible = selectVisibleMessages(messages)
    expect(visible.map((m) => m.id)).toEqual(['user-1', 'v2'])
  })

  it('excludes a grouped message with isActiveVersion missing or false', () => {
    const messages = [
      msg('v1', { metadata: { versionGroupId: 'g', versionIndex: 1 } }),
    ]
    expect(selectVisibleMessages(messages)).toEqual([])
  })
})

describe('getVersionInfoByMessageId', () => {
  it('omits ungrouped messages', () => {
    const map = getVersionInfoByMessageId([msg('a'), msg('b')])
    expect(map.size).toBe(0)
  })

  it('omits a group with only one surviving index', () => {
    const messages = [
      msg('v1', { metadata: { versionGroupId: 'g', versionIndex: 1, isActiveVersion: true } }),
    ]
    expect(getVersionInfoByMessageId(messages).size).toBe(0)
  })

  it('computes position/total for a two-version group', () => {
    const messages = [
      msg('v1', { metadata: { versionGroupId: 'g', versionIndex: 1, isActiveVersion: false } }),
      msg('v2', { metadata: { versionGroupId: 'g', versionIndex: 2, isActiveVersion: true } }),
    ]
    const map = getVersionInfoByMessageId(messages)
    expect(map.get('v1')).toEqual({ groupId: 'g', position: 1, total: 2 })
    expect(map.get('v2')).toEqual({ groupId: 'g', position: 2, total: 2 })
  })

  it('handles a multi-message version (e.g. assistant + tool message sharing an index)', () => {
    const messages = [
      msg('assistant-1', { metadata: { versionGroupId: 'g', versionIndex: 1, isActiveVersion: false } }),
      msg('tool-1', { metadata: { versionGroupId: 'g', versionIndex: 1, isActiveVersion: false } }),
      msg('assistant-2', { metadata: { versionGroupId: 'g', versionIndex: 2, isActiveVersion: true } }),
    ]
    const map = getVersionInfoByMessageId(messages)
    expect(map.get('assistant-1')).toEqual({ groupId: 'g', position: 1, total: 2 })
    expect(map.get('tool-1')).toEqual({ groupId: 'g', position: 1, total: 2 })
    expect(map.get('assistant-2')).toEqual({ groupId: 'g', position: 2, total: 2 })
  })

  it('keeps separate groups independent', () => {
    const messages = [
      msg('a-v1', { metadata: { versionGroupId: 'group-a', versionIndex: 1, isActiveVersion: false } }),
      msg('a-v2', { metadata: { versionGroupId: 'group-a', versionIndex: 2, isActiveVersion: true } }),
      msg('b-v1', { metadata: { versionGroupId: 'group-b', versionIndex: 1, isActiveVersion: false } }),
      msg('b-v2', { metadata: { versionGroupId: 'group-b', versionIndex: 2, isActiveVersion: false } }),
      msg('b-v3', { metadata: { versionGroupId: 'group-b', versionIndex: 3, isActiveVersion: true } }),
    ]
    const map = getVersionInfoByMessageId(messages)
    expect(map.get('a-v2')).toEqual({ groupId: 'group-a', position: 2, total: 2 })
    expect(map.get('b-v3')).toEqual({ groupId: 'group-b', position: 3, total: 3 })
  })
})
