import { describe, expect, it } from 'vitest'
import { parseSearchQuery, resolveSearchFilters } from '../parse-search-query'

const organization = {
  folders: [
    { id: 'folder-1', name: 'Work' },
    { id: 'folder-2', name: 'Side Projects' },
  ],
  tags: [
    { id: 'tag-1', name: 'urgent' },
    { id: 'tag-2', name: 'To Review' },
  ],
}

describe('parseSearchQuery', () => {
  it('returns the whole input as free text when no prefixes are used', () => {
    expect(parseSearchQuery('hello world')).toEqual({
      freeText: 'hello world',
      folderName: undefined,
      tagName: undefined,
      pinnedOnly: false,
    })
  })

  it('handles empty and whitespace-only input', () => {
    expect(parseSearchQuery('').freeText).toBe('')
    expect(parseSearchQuery('   ').freeText).toBe('')
    expect(parseSearchQuery('   ').pinnedOnly).toBe(false)
  })

  it('extracts a folder prefix and leaves the rest as free text', () => {
    expect(parseSearchQuery('folder:Work roadmap')).toEqual({
      freeText: 'roadmap',
      folderName: 'Work',
      tagName: undefined,
      pinnedOnly: false,
    })
  })

  it('extracts a tag prefix', () => {
    expect(parseSearchQuery('tag:urgent')).toEqual({
      freeText: '',
      folderName: undefined,
      tagName: 'urgent',
      pinnedOnly: false,
    })
  })

  it('extracts is:pinned', () => {
    expect(parseSearchQuery('is:pinned')).toEqual({
      freeText: '',
      folderName: undefined,
      tagName: undefined,
      pinnedOnly: true,
    })
    expect(parseSearchQuery('is:Pinned').pinnedOnly).toBe(true)
  })

  it('supports quoted values with spaces', () => {
    expect(parseSearchQuery('folder:"Side Projects"').folderName).toBe(
      'Side Projects'
    )
    expect(parseSearchQuery('tag:"To Review" draft').tagName).toBe('To Review')
    expect(parseSearchQuery('tag:"To Review" draft').freeText).toBe('draft')
  })

  it('combines multiple prefixes with free text', () => {
    expect(
      parseSearchQuery('folder:Work tag:urgent is:pinned deploy notes')
    ).toEqual({
      freeText: 'deploy notes',
      folderName: 'Work',
      tagName: 'urgent',
      pinnedOnly: true,
    })
  })

  it('treats unknown prefixes as free text', () => {
    expect(parseSearchQuery('project:alpha')).toEqual({
      freeText: 'project:alpha',
      folderName: undefined,
      tagName: undefined,
      pinnedOnly: false,
    })
  })

  it('treats unsupported is: values as free text', () => {
    expect(parseSearchQuery('is:archived').freeText).toBe('is:archived')
    expect(parseSearchQuery('is:archived').pinnedOnly).toBe(false)
  })

  it('treats prefixes with empty values as free text', () => {
    expect(parseSearchQuery('folder:').freeText).toBe('folder:')
    expect(parseSearchQuery('folder:').folderName).toBeUndefined()
    expect(parseSearchQuery('folder:""').freeText).toBe('folder:')
  })

  it('matches prefix keywords case-insensitively but keeps value case', () => {
    expect(parseSearchQuery('Folder:Work').folderName).toBe('Work')
    expect(parseSearchQuery('TAG:Urgent').tagName).toBe('Urgent')
  })

  it('lets a repeated prefix override the earlier one', () => {
    expect(parseSearchQuery('folder:Work folder:Personal').folderName).toBe(
      'Personal'
    )
  })

  it('keeps free text tokens in order with single spaces', () => {
    expect(parseSearchQuery('  alpha   beta  ').freeText).toBe('alpha beta')
  })
})

describe('resolveSearchFilters', () => {
  it('resolves folder and tag names case-insensitively', () => {
    expect(
      resolveSearchFilters(
        parseSearchQuery('folder:work tag:URGENT'),
        organization
      )
    ).toEqual({
      freeText: '',
      pinnedOnly: false,
      folderId: 'folder-1',
      tagId: 'tag-1',
    })
  })

  it('resolves quoted multi-word names', () => {
    expect(
      resolveSearchFilters(
        parseSearchQuery('folder:"side projects" tag:"to review"'),
        organization
      )
    ).toEqual({
      freeText: '',
      pinnedOnly: false,
      folderId: 'folder-2',
      tagId: 'tag-2',
    })
  })

  it('returns null for names that match nothing', () => {
    const resolved = resolveSearchFilters(
      parseSearchQuery('folder:Nope tag:nada'),
      organization
    )
    expect(resolved.folderId).toBeNull()
    expect(resolved.tagId).toBeNull()
  })

  it('passes through free text and pinnedOnly without name filters', () => {
    expect(
      resolveSearchFilters(parseSearchQuery('is:pinned hello'), organization)
    ).toEqual({
      freeText: 'hello',
      pinnedOnly: true,
      folderId: undefined,
      tagId: undefined,
    })
  })
})
