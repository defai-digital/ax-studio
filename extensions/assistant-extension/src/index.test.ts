import { describe, it, expect, vi, beforeEach } from 'vitest'

const {
  mockExistsSync,
  mockMkdir,
  mockReaddirSync,
  mockReadFileSync,
  mockWriteFileSync,
  mockRm,
  mockJoinPath,
  mockShowToast,
} = vi.hoisted(() => ({
  mockExistsSync: vi.fn(),
  mockMkdir: vi.fn(),
  mockReaddirSync: vi.fn(),
  mockReadFileSync: vi.fn(),
  mockWriteFileSync: vi.fn(),
  mockRm: vi.fn(),
  mockJoinPath: vi.fn(),
  mockShowToast: vi.fn(),
}))

vi.mock('@ax-studio/core', () => {
  class AssistantExtension {
    name = ''
    url = ''
    active = false
    description = ''
    version = ''
    constructor() {}
    type() {
      return 'assistant'
    }
    async registerSettings() {}
    async getSetting<T>(_key: string, defaultValue: T) {
      return defaultValue
    }
    onSettingUpdate() {}
    async getSettings() {
      return []
    }
    async updateSettings() {}
  }

  return {
    AssistantExtension,
    fs: {
      existsSync: mockExistsSync,
      mkdir: mockMkdir,
      readdirSync: mockReaddirSync,
      readFileSync: mockReadFileSync,
      writeFileSync: mockWriteFileSync,
      rm: mockRm,
    },
    joinPath: mockJoinPath,
    showToast: mockShowToast,
  }
})

import AxStudioAssistantExtension from './index'

describe('AxStudioAssistantExtension', () => {
  let ext: AxStudioAssistantExtension

  beforeEach(() => {
    vi.clearAllMocks()
    ext = new AxStudioAssistantExtension('', '')
  })

  describe('onLoad', () => {
    it('creates the assistants directory if it does not exist', async () => {
      mockExistsSync.mockResolvedValueOnce(false) // directory check
      mockExistsSync.mockResolvedValueOnce(false) // getAssistants directory check
      mockMkdir.mockResolvedValue(undefined)

      await ext.onLoad()

      expect(mockMkdir).toHaveBeenCalledWith('file://assistants')
    })

    it('does not create directory if it already exists', async () => {
      mockExistsSync.mockResolvedValueOnce(true) // directory exists
      // getAssistants returns empty => will create default assistant
      mockExistsSync.mockResolvedValueOnce(true) // getAssistants dir check
      mockReaddirSync.mockResolvedValue([])
      // createAssistant calls
      mockJoinPath.mockResolvedValueOnce('file://assistants/ax-studio/assistant.json')
      mockJoinPath.mockResolvedValueOnce('file://assistants/ax-studio')
      mockExistsSync.mockResolvedValueOnce(false)
      mockMkdir.mockResolvedValue(undefined)
      mockWriteFileSync.mockResolvedValue(undefined)

      await ext.onLoad()

      // mkdir should not be called with root dir since it already exists
      // but it should be called for the assistant subfolder
      const mkdirCalls = mockMkdir.mock.calls.map(
        (c: unknown[]) => c[0]
      )
      expect(mkdirCalls).not.toContain('file://assistants')
    })

    it('creates the default assistant when no assistants exist', async () => {
      mockExistsSync.mockResolvedValueOnce(true) // directory exists
      mockExistsSync.mockResolvedValueOnce(true) // getAssistants dir check
      mockReaddirSync.mockResolvedValue([]) // no assistants
      // createAssistant joinPath calls
      mockJoinPath.mockResolvedValueOnce(
        'file://assistants/ax-studio/assistant.json'
      )
      mockJoinPath.mockResolvedValueOnce('file://assistants/ax-studio')
      mockExistsSync.mockResolvedValueOnce(false) // folder doesn't exist
      mockMkdir.mockResolvedValue(undefined)
      mockWriteFileSync.mockResolvedValue(undefined)

      await ext.onLoad()

      expect(mockWriteFileSync).toHaveBeenCalledTimes(1)
      const writtenData = JSON.parse(mockWriteFileSync.mock.calls[0][1])
      expect(writtenData.id).toBe('ax-studio')
      expect(writtenData.name).toBe('Ax-Studio')
      expect(writtenData.parameters.temperature).toBe(0.7)
      expect(writtenData.parameters.top_k).toBe(20)
      expect(writtenData.parameters.top_p).toBe(0.8)
      expect(writtenData.parameters.repeat_penalty).toBe(1.12)
    })

    it('does not create default assistant when assistants already exist', async () => {
      const existingAssistant = { id: 'custom', name: 'Custom' }
      mockExistsSync.mockResolvedValueOnce(true) // directory exists
      mockExistsSync.mockResolvedValueOnce(true) // getAssistants dir check
      mockReaddirSync.mockResolvedValue(['custom'])
      mockJoinPath.mockResolvedValueOnce(
        'file://assistants/custom/assistant.json'
      )
      mockExistsSync.mockResolvedValueOnce(true) // assistant.json exists
      mockReadFileSync.mockResolvedValueOnce(
        JSON.stringify(existingAssistant)
      )

      await ext.onLoad()

      expect(mockWriteFileSync).not.toHaveBeenCalled()
    })
  })

  describe('onUnload', () => {
    it('does nothing and returns undefined', () => {
      expect(ext.onUnload()).toBeUndefined()
    })
  })

  describe('getAssistants', () => {
    it('returns empty array when directory does not exist', async () => {
      mockExistsSync.mockResolvedValueOnce(false)

      const result = await ext.getAssistants()

      expect(result).toEqual([])
    })

    it('reads and parses assistant files from directory', async () => {
      const assistant1 = { id: 'a1', name: 'Assistant 1' }
      const assistant2 = { id: 'a2', name: 'Assistant 2' }

      mockExistsSync.mockResolvedValueOnce(true) // dir exists
      mockReaddirSync.mockResolvedValue(['a1', 'a2'])
      mockJoinPath.mockResolvedValueOnce(
        'file://assistants/a1/assistant.json'
      )
      mockExistsSync.mockResolvedValueOnce(true) // a1 exists
      mockReadFileSync.mockResolvedValueOnce(JSON.stringify(assistant1))
      mockJoinPath.mockResolvedValueOnce(
        'file://assistants/a2/assistant.json'
      )
      mockExistsSync.mockResolvedValueOnce(true) // a2 exists
      mockReadFileSync.mockResolvedValueOnce(JSON.stringify(assistant2))

      const result = await ext.getAssistants()

      expect(result).toHaveLength(2)
      expect(result[0].id).toBe('a1')
      expect(result[1].id).toBe('a2')
    })

    it('skips assistants without assistant.json file', async () => {
      mockExistsSync.mockResolvedValueOnce(true) // dir exists
      mockReaddirSync.mockResolvedValue(['a1', 'a2'])
      mockJoinPath.mockResolvedValueOnce(
        'file://assistants/a1/assistant.json'
      )
      mockExistsSync.mockResolvedValueOnce(false) // a1 missing
      mockJoinPath.mockResolvedValueOnce(
        'file://assistants/a2/assistant.json'
      )
      mockExistsSync.mockResolvedValueOnce(true) // a2 exists
      mockReadFileSync.mockResolvedValueOnce(
        JSON.stringify({ id: 'a2', name: 'A2' })
      )

      const result = await ext.getAssistants()

      expect(result).toHaveLength(1)
      expect(result[0].id).toBe('a2')
    })

    it('handles JSON parse errors gracefully', async () => {
      const consoleSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {})

      mockExistsSync.mockResolvedValueOnce(true)
      mockReaddirSync.mockResolvedValue(['bad'])
      mockJoinPath.mockResolvedValueOnce(
        'file://assistants/bad/assistant.json'
      )
      mockExistsSync.mockResolvedValueOnce(true)
      mockReadFileSync.mockResolvedValueOnce('invalid json{{{')

      const result = await ext.getAssistants()

      expect(result).toHaveLength(0)
      expect(consoleSpy).toHaveBeenCalledWith(
        'Failed to read assistant bad:',
        expect.any(SyntaxError)
      )
      expect(mockShowToast).toHaveBeenCalledWith(
        'Some assistants could not be loaded',
        'Skipped corrupt assistant data for bad.'
      )

      consoleSpy.mockRestore()
    })

    it('returns valid assistants even when another file has malformed JSON', async () => {
      const consoleSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {})

      mockExistsSync.mockResolvedValueOnce(true)
      mockReaddirSync.mockResolvedValue(['good', 'bad'])
      mockJoinPath.mockResolvedValueOnce(
        'file://assistants/good/assistant.json'
      )
      mockExistsSync.mockResolvedValueOnce(true)
      mockReadFileSync.mockResolvedValueOnce(
        JSON.stringify({ id: 'good', name: 'Good Assistant' })
      )
      mockJoinPath.mockResolvedValueOnce(
        'file://assistants/bad/assistant.json'
      )
      mockExistsSync.mockResolvedValueOnce(true)
      mockReadFileSync.mockResolvedValueOnce('invalid json{{{')

      const result = await ext.getAssistants()

      expect(result).toEqual([{ id: 'good', name: 'Good Assistant' }])
      expect(consoleSpy).toHaveBeenCalledWith(
        'Failed to read assistant bad:',
        expect.any(SyntaxError)
      )
      expect(mockShowToast).toHaveBeenCalledWith(
        'Some assistants could not be loaded',
        'Skipped corrupt assistant data for bad.'
      )

      consoleSpy.mockRestore()
    })

    it('treats structurally invalid assistant JSON as corrupt data', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      mockExistsSync.mockResolvedValueOnce(true)
      mockReaddirSync.mockResolvedValue(['bad-shape'])
      mockJoinPath.mockResolvedValueOnce(
        'file://assistants/bad-shape/assistant.json'
      )
      mockExistsSync.mockResolvedValueOnce(true)
      mockReadFileSync.mockResolvedValueOnce(JSON.stringify({ id: 123 }))

      const result = await ext.getAssistants()

      expect(result).toEqual([])
      expect(consoleSpy).toHaveBeenCalledWith(
        'Failed to read assistant bad-shape:',
        expect.any(Error)
      )
      expect(mockShowToast).toHaveBeenCalledWith(
        'Some assistants could not be loaded',
        'Skipped corrupt assistant data for bad-shape.'
      )

      consoleSpy.mockRestore()
    })

    it('returns empty array when directory exists but is empty', async () => {
      mockExistsSync.mockResolvedValueOnce(true)
      mockReaddirSync.mockResolvedValue([])

      const result = await ext.getAssistants()

      expect(result).toHaveLength(0)
    })
  })

  describe('createAssistant', () => {
    it('creates folder and writes assistant file', async () => {
      const assistant = { id: 'new-assist', name: 'New' } as any

      mockJoinPath.mockResolvedValueOnce(
        'file://assistants/new-assist/assistant.json'
      )
      mockJoinPath.mockResolvedValueOnce('file://assistants/new-assist')
      mockExistsSync.mockResolvedValueOnce(false) // folder doesn't exist
      mockMkdir.mockResolvedValue(undefined)
      mockWriteFileSync.mockResolvedValue(undefined)

      await ext.createAssistant(assistant)

      expect(mockMkdir).toHaveBeenCalledWith('file://assistants/new-assist')
      expect(mockWriteFileSync).toHaveBeenCalledWith(
        'file://assistants/new-assist/assistant.json',
        JSON.stringify(assistant, null, 2)
      )
    })

    it('does not create folder if it already exists', async () => {
      const assistant = { id: 'existing', name: 'Existing' } as any

      mockJoinPath.mockResolvedValueOnce(
        'file://assistants/existing/assistant.json'
      )
      mockJoinPath.mockResolvedValueOnce('file://assistants/existing')
      mockExistsSync.mockResolvedValueOnce(true) // folder already exists
      mockWriteFileSync.mockResolvedValue(undefined)

      await ext.createAssistant(assistant)

      expect(mockMkdir).not.toHaveBeenCalled()
      expect(mockWriteFileSync).toHaveBeenCalledTimes(1)
    })
  })

  describe('deleteAssistant', () => {
    it('removes the assistant file and folder when they exist', async () => {
      const assistant = { id: 'del-me', name: 'Delete Me' } as any

      mockJoinPath.mockResolvedValueOnce(
        'file://assistants/del-me/assistant.json'
      )
      mockJoinPath.mockResolvedValueOnce('file://assistants/del-me')
      mockExistsSync.mockResolvedValueOnce(true)
      mockExistsSync.mockResolvedValueOnce(true)
      mockRm.mockResolvedValue(undefined)

      await ext.deleteAssistant(assistant)

      expect(mockRm).toHaveBeenCalledWith(
        'file://assistants/del-me/assistant.json'
      )
      expect(mockRm).toHaveBeenCalledWith('file://assistants/del-me')
    })

    it('does nothing when assistant file does not exist', async () => {
      const assistant = { id: 'ghost', name: 'Ghost' } as any

      mockJoinPath.mockResolvedValueOnce(
        'file://assistants/ghost/assistant.json'
      )
      mockJoinPath.mockResolvedValueOnce('file://assistants/ghost')
      mockExistsSync.mockResolvedValueOnce(false)
      mockExistsSync.mockResolvedValueOnce(false)

      await ext.deleteAssistant(assistant)

      expect(mockRm).not.toHaveBeenCalled()
    })
  })
})
