import { describe, it, expect, beforeEach, vi } from 'vitest'
import { act } from '@testing-library/react'
import { useAttachmentIngestionPrompt } from '../useAttachmentIngestionPrompt'

const getState = () => useAttachmentIngestionPrompt.getState()

const mockAttachment = { name: 'large-file.pdf', size: 5_000_000 }

describe('useAttachmentIngestionPrompt', () => {
  beforeEach(() => {
    act(() => {
      useAttachmentIngestionPrompt.setState({
        isModalOpen: false,
        currentAttachment: null,
        currentIndex: 0,
        totalCount: 0,
        sizeThreshold: 0,
        resolver: null,
      })
    })
  })

  describe('initial state', () => {
    it('starts with modal closed', () => {
      expect(getState().isModalOpen).toBe(false)
    })

    it('starts with no current attachment', () => {
      expect(getState().currentAttachment).toBeNull()
    })

    it('starts with no resolver', () => {
      expect(getState().resolver).toBeNull()
    })

    it('starts with currentIndex 0', () => {
      expect(getState().currentIndex).toBe(0)
    })

    it('starts with totalCount 0', () => {
      expect(getState().totalCount).toBe(0)
    })

    it('starts with sizeThreshold 0', () => {
      expect(getState().sizeThreshold).toBe(0)
    })
  })

  describe('showPrompt', () => {
    it('opens the modal', async () => {
      // Don't await — it won't resolve until choose/cancel is called
      getState().showPrompt(mockAttachment, 1_000_000, 0, 3)
      // Give microtask a tick for the set() inside the Promise constructor
      await Promise.resolve()
      expect(getState().isModalOpen).toBe(true)
    })

    it('sets the current attachment', async () => {
      getState().showPrompt(mockAttachment, 1_000_000, 0, 3)
      await Promise.resolve()
      expect(getState().currentAttachment).toEqual(mockAttachment)
    })

    it('sets currentIndex, totalCount, and sizeThreshold', async () => {
      getState().showPrompt(mockAttachment, 2_000_000, 2, 5)
      await Promise.resolve()
      expect(getState().currentIndex).toBe(2)
      expect(getState().totalCount).toBe(5)
      expect(getState().sizeThreshold).toBe(2_000_000)
    })

    it('sets a resolver function', async () => {
      getState().showPrompt(mockAttachment, 1_000_000, 0, 1)
      await Promise.resolve()
      expect(typeof getState().resolver).toBe('function')
    })

    it('resolves with the choice when choose is called', async () => {
      const promise = getState().showPrompt(mockAttachment, 1_000_000, 0, 1)
      await Promise.resolve()
      act(() => {
        getState().choose('embeddings')
      })
      const result = await promise
      expect(result).toBe('embeddings')
    })

    it('resolves with undefined when cancel is called', async () => {
      const promise = getState().showPrompt(mockAttachment, 1_000_000, 0, 1)
      await Promise.resolve()
      act(() => {
        getState().cancel()
      })
      const result = await promise
      expect(result).toBeUndefined()
    })
  })

  describe('choose', () => {
    it('closes the modal', async () => {
      getState().showPrompt(mockAttachment, 1_000_000, 0, 1)
      await Promise.resolve()
      act(() => {
        getState().choose('inline')
      })
      expect(getState().isModalOpen).toBe(false)
    })

    it('clears the current attachment', async () => {
      getState().showPrompt(mockAttachment, 1_000_000, 0, 1)
      await Promise.resolve()
      act(() => {
        getState().choose('inline')
      })
      expect(getState().currentAttachment).toBeNull()
    })

    it('clears the resolver', async () => {
      getState().showPrompt(mockAttachment, 1_000_000, 0, 1)
      await Promise.resolve()
      act(() => {
        getState().choose('inline')
      })
      expect(getState().resolver).toBeNull()
    })

    it('is safe to call when no resolver is set', () => {
      // Should not throw
      act(() => {
        getState().choose('inline')
      })
      expect(getState().isModalOpen).toBe(false)
    })

    it('resolves with inline when inline is chosen', async () => {
      const promise = getState().showPrompt(mockAttachment, 1_000_000, 0, 1)
      await Promise.resolve()
      act(() => {
        getState().choose('inline')
      })
      const result = await promise
      expect(result).toBe('inline')
    })
  })

  describe('cancel', () => {
    it('closes the modal', async () => {
      getState().showPrompt(mockAttachment, 1_000_000, 0, 1)
      await Promise.resolve()
      act(() => {
        getState().cancel()
      })
      expect(getState().isModalOpen).toBe(false)
    })

    it('clears the current attachment', async () => {
      getState().showPrompt(mockAttachment, 1_000_000, 0, 1)
      await Promise.resolve()
      act(() => {
        getState().cancel()
      })
      expect(getState().currentAttachment).toBeNull()
    })

    it('clears the resolver', async () => {
      getState().showPrompt(mockAttachment, 1_000_000, 0, 1)
      await Promise.resolve()
      act(() => {
        getState().cancel()
      })
      expect(getState().resolver).toBeNull()
    })

    it('is safe to call when no resolver is set', () => {
      act(() => {
        getState().cancel()
      })
      expect(getState().isModalOpen).toBe(false)
    })
  })

  describe('sequential prompts', () => {
    it('can handle multiple sequential show/choose cycles', async () => {
      // First prompt
      const p1 = getState().showPrompt(mockAttachment, 1_000_000, 0, 2)
      await Promise.resolve()
      act(() => {
        getState().choose('inline')
      })
      expect(await p1).toBe('inline')

      // Second prompt
      const attachment2 = { name: 'file2.pdf', size: 3_000_000 }
      const p2 = getState().showPrompt(attachment2, 1_000_000, 1, 2)
      await Promise.resolve()
      expect(getState().currentAttachment).toEqual(attachment2)
      expect(getState().currentIndex).toBe(1)
      act(() => {
        getState().choose('embeddings')
      })
      expect(await p2).toBe('embeddings')
    })
  })
})
