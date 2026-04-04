import { describe, it, expect, beforeEach } from 'vitest'
import { act } from '@testing-library/react'
import {
  useChatAttachments,
  NEW_THREAD_ATTACHMENT_KEY,
} from './useChatAttachments'
import type { Attachment } from '@/types/attachment'

const getState = () => useChatAttachments.getState()

const makeAttachment = (name: string): Attachment => ({
  name,
  type: 'document',
  size: 100,
})

describe('useChatAttachments', () => {
  beforeEach(() => {
    act(() => {
      useChatAttachments.setState({ attachmentsByThread: {} })
    })
  })

  describe('initial state', () => {
    it('starts with empty attachmentsByThread', () => {
      expect(getState().attachmentsByThread).toEqual({})
    })
  })

  describe('getAttachments', () => {
    it('returns empty array for unknown thread', () => {
      const result = getState().getAttachments('unknown')
      expect(result).toEqual([])
    })

    it('defaults to NEW_THREAD_ATTACHMENT_KEY when no threadId given', () => {
      act(() => {
        getState().setAttachments(NEW_THREAD_ATTACHMENT_KEY, [
          makeAttachment('file.txt'),
        ])
      })
      const result = getState().getAttachments()
      expect(result).toHaveLength(1)
      expect(result[0].name).toBe('file.txt')
    })

    it('returns the same empty array reference for unknown threads', () => {
      const a = getState().getAttachments('x')
      const b = getState().getAttachments('y')
      expect(a).toBe(b)
    })
  })

  describe('setAttachments', () => {
    it('sets attachments with an array value', () => {
      const attachments = [makeAttachment('a.pdf')]
      act(() => {
        getState().setAttachments('t1', attachments)
      })
      expect(getState().getAttachments('t1')).toHaveLength(1)
      expect(getState().getAttachments('t1')[0].name).toBe('a.pdf')
    })

    it('sets attachments with an updater function', () => {
      act(() => {
        getState().setAttachments('t1', [makeAttachment('a.pdf')])
      })
      act(() => {
        getState().setAttachments('t1', (prev) => [
          ...prev,
          makeAttachment('b.pdf'),
        ])
      })
      expect(getState().getAttachments('t1')).toHaveLength(2)
    })

    it('updater receives empty array when thread has no attachments', () => {
      act(() => {
        getState().setAttachments('t1', (prev) => {
          expect(prev).toEqual([])
          return [makeAttachment('new.pdf')]
        })
      })
      expect(getState().getAttachments('t1')).toHaveLength(1)
    })

    it('replaces entire array when given a direct value', () => {
      act(() => {
        getState().setAttachments('t1', [
          makeAttachment('a'),
          makeAttachment('b'),
        ])
      })
      act(() => {
        getState().setAttachments('t1', [makeAttachment('c')])
      })
      const result = getState().getAttachments('t1')
      expect(result).toHaveLength(1)
      expect(result[0].name).toBe('c')
    })
  })

  describe('thread isolation', () => {
    it('setting attachments for thread A does not affect thread B', () => {
      act(() => {
        getState().setAttachments('tA', [makeAttachment('a')])
      })
      expect(getState().getAttachments('tB')).toEqual([])
    })
  })

  describe('clearAttachments', () => {
    it('removes attachments for the specified thread', () => {
      act(() => {
        getState().setAttachments('t1', [makeAttachment('a')])
      })
      act(() => {
        getState().clearAttachments('t1')
      })
      expect(getState().getAttachments('t1')).toEqual([])
      expect(getState().attachmentsByThread['t1']).toBeUndefined()
    })

    it('does not affect other threads', () => {
      act(() => {
        getState().setAttachments('tA', [makeAttachment('a')])
        getState().setAttachments('tB', [makeAttachment('b')])
      })
      act(() => {
        getState().clearAttachments('tA')
      })
      expect(getState().getAttachments('tB')).toHaveLength(1)
    })

    it('is safe to call on unknown thread', () => {
      act(() => {
        getState().clearAttachments('nonexistent')
      })
      expect(getState().attachmentsByThread).toEqual({})
    })
  })

  describe('transferAttachments', () => {
    it('moves attachments from source to destination', () => {
      act(() => {
        getState().setAttachments('from', [makeAttachment('file')])
      })
      act(() => {
        getState().transferAttachments('from', 'to')
      })
      expect(getState().getAttachments('to')).toHaveLength(1)
      expect(getState().getAttachments('to')[0].name).toBe('file')
    })

    it('removes the source key after transfer', () => {
      act(() => {
        getState().setAttachments('from', [makeAttachment('file')])
      })
      act(() => {
        getState().transferAttachments('from', 'to')
      })
      expect(getState().attachmentsByThread['from']).toBeUndefined()
    })

    it('is a no-op when source has no attachments', () => {
      act(() => {
        getState().setAttachments('to', [makeAttachment('existing')])
      })
      const stateBefore = { ...getState().attachmentsByThread }
      act(() => {
        getState().transferAttachments('empty', 'to')
      })
      expect(getState().attachmentsByThread).toEqual(stateBefore)
    })

    it('is a no-op when source has empty array', () => {
      act(() => {
        getState().setAttachments('from', [])
      })
      act(() => {
        getState().transferAttachments('from', 'to')
      })
      expect(getState().getAttachments('to')).toEqual([])
    })

    it('does not overwrite existing destination attachments', () => {
      act(() => {
        getState().setAttachments('from', [makeAttachment('new-file')])
        getState().setAttachments('to', [makeAttachment('existing-file')])
      })
      act(() => {
        getState().transferAttachments('from', 'to')
      })
      const result = getState().getAttachments('to')
      expect(result).toHaveLength(1)
      expect(result[0].name).toBe('existing-file')
    })

    it('transfers when destination exists but is empty', () => {
      act(() => {
        getState().setAttachments('from', [makeAttachment('file')])
        getState().setAttachments('to', [])
      })
      act(() => {
        getState().transferAttachments('from', 'to')
      })
      expect(getState().getAttachments('to')[0].name).toBe('file')
    })

    it('can transfer from NEW_THREAD_ATTACHMENT_KEY to a real thread', () => {
      act(() => {
        getState().setAttachments(NEW_THREAD_ATTACHMENT_KEY, [
          makeAttachment('draft'),
        ])
      })
      act(() => {
        getState().transferAttachments(NEW_THREAD_ATTACHMENT_KEY, 'thread-123')
      })
      expect(getState().getAttachments('thread-123')[0].name).toBe('draft')
      expect(
        getState().attachmentsByThread[NEW_THREAD_ATTACHMENT_KEY]
      ).toBeUndefined()
    })
  })
})
