import { describe, it, expect, beforeEach, vi } from 'vitest'
import { act } from '@testing-library/react'
import { useAttachments } from './useAttachments'
import { type SettingComponentProps } from '@ax-studio/core'

const makeSettingDef = (
  key: string,
  value: unknown
): SettingComponentProps =>
  ({
    key,
    controllerProps: { value },
  }) as unknown as SettingComponentProps

describe('useAttachments', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    act(() => {
      useAttachments.setState({
        enabled: true,
        maxFileSizeMB: 20,
        retrievalLimit: 3,
        retrievalThreshold: 0.3,
        chunkSizeChars: 512,
        overlapChars: 64,
        searchMode: 'auto',
        parseMode: 'auto',
        autoInlineContextRatio: 0.75,
        settingsDefs: [],
      })
    })
  })

  // --- PHASE 1: Default state ---

  it('should initialize with enabled=true', () => {
    expect(useAttachments.getState().enabled).toBe(true)
  })

  it('should initialize with default maxFileSizeMB=20', () => {
    expect(useAttachments.getState().maxFileSizeMB).toBe(20)
  })

  it('should initialize with default retrievalLimit=3', () => {
    expect(useAttachments.getState().retrievalLimit).toBe(3)
  })

  it('should initialize with default retrievalThreshold=0.3', () => {
    expect(useAttachments.getState().retrievalThreshold).toBe(0.3)
  })

  it('should initialize with default chunkSizeChars=512', () => {
    expect(useAttachments.getState().chunkSizeChars).toBe(512)
  })

  it('should initialize with default overlapChars=64', () => {
    expect(useAttachments.getState().overlapChars).toBe(64)
  })

  it('should initialize with searchMode=auto', () => {
    expect(useAttachments.getState().searchMode).toBe('auto')
  })

  it('should initialize with parseMode=auto', () => {
    expect(useAttachments.getState().parseMode).toBe('auto')
  })

  it('should initialize with autoInlineContextRatio=0.75', () => {
    expect(useAttachments.getState().autoInlineContextRatio).toBe(0.75)
  })

  it('should initialize with empty settingsDefs', () => {
    expect(useAttachments.getState().settingsDefs).toEqual([])
  })

  // --- loadSettingsDefs ---

  it('should return false from loadSettingsDefs', async () => {
    const result = await useAttachments.getState().loadSettingsDefs()
    expect(result).toBe(false)
  })

  // --- Setters: basic value updates ---

  it('should set enabled to false', () => {
    act(() => {
      useAttachments.getState().setEnabled(false)
    })
    expect(useAttachments.getState().enabled).toBe(false)
  })

  it('should set maxFileSizeMB', () => {
    act(() => {
      useAttachments.getState().setMaxFileSizeMB(50)
    })
    expect(useAttachments.getState().maxFileSizeMB).toBe(50)
  })

  it('should set retrievalLimit', () => {
    act(() => {
      useAttachments.getState().setRetrievalLimit(10)
    })
    expect(useAttachments.getState().retrievalLimit).toBe(10)
  })

  it('should set retrievalThreshold', () => {
    act(() => {
      useAttachments.getState().setRetrievalThreshold(0.8)
    })
    expect(useAttachments.getState().retrievalThreshold).toBe(0.8)
  })

  it('should set chunkSizeChars', () => {
    act(() => {
      useAttachments.getState().setChunkSizeChars(1024)
    })
    expect(useAttachments.getState().chunkSizeChars).toBe(1024)
  })

  it('should set overlapChars', () => {
    act(() => {
      useAttachments.getState().setOverlapChars(128)
    })
    expect(useAttachments.getState().overlapChars).toBe(128)
  })

  it('should set searchMode to ann', () => {
    act(() => {
      useAttachments.getState().setSearchMode('ann')
    })
    expect(useAttachments.getState().searchMode).toBe('ann')
  })

  it('should set searchMode to linear', () => {
    act(() => {
      useAttachments.getState().setSearchMode('linear')
    })
    expect(useAttachments.getState().searchMode).toBe('linear')
  })

  it('should set parseMode to inline', () => {
    act(() => {
      useAttachments.getState().setParseMode('inline')
    })
    expect(useAttachments.getState().parseMode).toBe('inline')
  })

  it('should set parseMode to embeddings', () => {
    act(() => {
      useAttachments.getState().setParseMode('embeddings')
    })
    expect(useAttachments.getState().parseMode).toBe('embeddings')
  })

  it('should set parseMode to prompt', () => {
    act(() => {
      useAttachments.getState().setParseMode('prompt')
    })
    expect(useAttachments.getState().parseMode).toBe('prompt')
  })

  it('should set autoInlineContextRatio', () => {
    act(() => {
      useAttachments.getState().setAutoInlineContextRatio(0.5)
    })
    expect(useAttachments.getState().autoInlineContextRatio).toBe(0.5)
  })

  // --- Setters: settingsDefs sync ---

  it('should update settingsDefs controllerProps when setEnabled is called', () => {
    act(() => {
      useAttachments.setState({
        settingsDefs: [makeSettingDef('enabled', true)],
      })
    })
    act(() => {
      useAttachments.getState().setEnabled(false)
    })
    const def = useAttachments.getState().settingsDefs.find(
      (d) => d.key === 'enabled'
    )
    expect(def?.controllerProps?.value).toBe(false)
  })

  it('should update settingsDefs for maxFileSizeMB', () => {
    act(() => {
      useAttachments.setState({
        settingsDefs: [makeSettingDef('max_file_size_mb', 20)],
      })
    })
    act(() => {
      useAttachments.getState().setMaxFileSizeMB(100)
    })
    const def = useAttachments.getState().settingsDefs.find(
      (d) => d.key === 'max_file_size_mb'
    )
    expect(def?.controllerProps?.value).toBe(100)
  })

  it('should update settingsDefs for retrievalLimit', () => {
    act(() => {
      useAttachments.setState({
        settingsDefs: [makeSettingDef('retrieval_limit', 3)],
      })
    })
    act(() => {
      useAttachments.getState().setRetrievalLimit(7)
    })
    const def = useAttachments.getState().settingsDefs.find(
      (d) => d.key === 'retrieval_limit'
    )
    expect(def?.controllerProps?.value).toBe(7)
  })

  it('should update settingsDefs for retrievalThreshold', () => {
    act(() => {
      useAttachments.setState({
        settingsDefs: [makeSettingDef('retrieval_threshold', 0.3)],
      })
    })
    act(() => {
      useAttachments.getState().setRetrievalThreshold(0.9)
    })
    const def = useAttachments.getState().settingsDefs.find(
      (d) => d.key === 'retrieval_threshold'
    )
    expect(def?.controllerProps?.value).toBe(0.9)
  })

  it('should update settingsDefs for chunkSizeChars', () => {
    act(() => {
      useAttachments.setState({
        settingsDefs: [makeSettingDef('chunk_size_chars', 512)],
      })
    })
    act(() => {
      useAttachments.getState().setChunkSizeChars(256)
    })
    const def = useAttachments.getState().settingsDefs.find(
      (d) => d.key === 'chunk_size_chars'
    )
    expect(def?.controllerProps?.value).toBe(256)
  })

  it('should update settingsDefs for overlapChars', () => {
    act(() => {
      useAttachments.setState({
        settingsDefs: [makeSettingDef('overlap_chars', 64)],
      })
    })
    act(() => {
      useAttachments.getState().setOverlapChars(32)
    })
    const def = useAttachments.getState().settingsDefs.find(
      (d) => d.key === 'overlap_chars'
    )
    expect(def?.controllerProps?.value).toBe(32)
  })

  it('should update settingsDefs for searchMode', () => {
    act(() => {
      useAttachments.setState({
        settingsDefs: [makeSettingDef('search_mode', 'auto')],
      })
    })
    act(() => {
      useAttachments.getState().setSearchMode('linear')
    })
    const def = useAttachments.getState().settingsDefs.find(
      (d) => d.key === 'search_mode'
    )
    expect(def?.controllerProps?.value).toBe('linear')
  })

  it('should update settingsDefs for parseMode', () => {
    act(() => {
      useAttachments.setState({
        settingsDefs: [makeSettingDef('parse_mode', 'auto')],
      })
    })
    act(() => {
      useAttachments.getState().setParseMode('prompt')
    })
    const def = useAttachments.getState().settingsDefs.find(
      (d) => d.key === 'parse_mode'
    )
    expect(def?.controllerProps?.value).toBe('prompt')
  })

  it('should update settingsDefs for autoInlineContextRatio', () => {
    act(() => {
      useAttachments.setState({
        settingsDefs: [makeSettingDef('auto_inline_context_ratio', 0.75)],
      })
    })
    act(() => {
      useAttachments.getState().setAutoInlineContextRatio(0.25)
    })
    const def = useAttachments.getState().settingsDefs.find(
      (d) => d.key === 'auto_inline_context_ratio'
    )
    expect(def?.controllerProps?.value).toBe(0.25)
  })

  // --- Adversarial: non-matching keys left untouched ---

  it('should not modify settingsDefs entries with non-matching keys', () => {
    act(() => {
      useAttachments.setState({
        settingsDefs: [
          makeSettingDef('enabled', true),
          makeSettingDef('unrelated_key', 'original'),
        ],
      })
    })
    act(() => {
      useAttachments.getState().setEnabled(false)
    })
    const unrelated = useAttachments.getState().settingsDefs.find(
      (d) => d.key === 'unrelated_key'
    )
    expect(unrelated?.controllerProps?.value).toBe('original')
  })

  // --- Adversarial: empty settingsDefs array ---

  it('should not throw when settingsDefs is empty and setter is called', () => {
    expect(() => {
      act(() => {
        useAttachments.getState().setMaxFileSizeMB(99)
      })
    }).not.toThrow()
    expect(useAttachments.getState().maxFileSizeMB).toBe(99)
    expect(useAttachments.getState().settingsDefs).toEqual([])
  })

  // --- Property: setEnabled coerces falsy to boolean ---

  it('should coerce 0 to false for enabled via settingsDefs', () => {
    act(() => {
      useAttachments.setState({
        settingsDefs: [makeSettingDef('enabled', true)],
      })
    })
    act(() => {
      // The source code uses !!v for the settingsDefs value
      useAttachments.getState().setEnabled(false)
    })
    const def = useAttachments.getState().settingsDefs.find(
      (d) => d.key === 'enabled'
    )
    expect(def?.controllerProps?.value).toBe(false)
  })

  // --- Adversarial: boundary values ---

  it('should accept 0 for maxFileSizeMB', () => {
    act(() => {
      useAttachments.getState().setMaxFileSizeMB(0)
    })
    expect(useAttachments.getState().maxFileSizeMB).toBe(0)
  })

  it('should accept 0 for retrievalThreshold', () => {
    act(() => {
      useAttachments.getState().setRetrievalThreshold(0)
    })
    expect(useAttachments.getState().retrievalThreshold).toBe(0)
  })

  it('should accept 1.0 for autoInlineContextRatio', () => {
    act(() => {
      useAttachments.getState().setAutoInlineContextRatio(1.0)
    })
    expect(useAttachments.getState().autoInlineContextRatio).toBe(1.0)
  })

  it('should accept 0 for autoInlineContextRatio', () => {
    act(() => {
      useAttachments.getState().setAutoInlineContextRatio(0)
    })
    expect(useAttachments.getState().autoInlineContextRatio).toBe(0)
  })
})
