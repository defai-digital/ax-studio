import { describe, it, expect } from 'vitest'
import {
  parseMemoryFromResponse,
  extractFactsFromPatterns,
  mergePatternFacts,
  buildMemoryContext,
} from '../memory-extractor'
import type { MemoryEntry } from '@/hooks/useMemory'

function makeEntry(overrides: Partial<MemoryEntry> = {}): MemoryEntry {
  const now = Date.now()
  return {
    id: `mem-${now}`,
    fact: 'Test fact',
    sourceThreadId: 'thread-1',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

// ─── parseMemoryFromResponse ────────────────────────────────────────────

describe('parseMemoryFromResponse', () => {
  it('should return empty facts when no memory_extract tag is present', () => {
    const result = parseMemoryFromResponse('Hello, how are you?')
    expect(result.facts).toEqual([])
    expect(result.isFullReplace).toBe(false)
    expect(result.cleanedText).toBe('Hello, how are you?')
  })

  it('should parse valid memory_extract JSON array', () => {
    const text = 'Here is my response.\n<memory_extract>["User name is Alex", "User lives in NYC"]</memory_extract>'
    const result = parseMemoryFromResponse(text)
    expect(result.facts).toEqual(['User name is Alex', 'User lives in NYC'])
    expect(result.isFullReplace).toBe(true)
    expect(result.cleanedText).toBe('Here is my response.')
  })

  it('should strip the memory_extract tag from cleaned text', () => {
    const text = 'Some text before <memory_extract>["fact"]</memory_extract>'
    const result = parseMemoryFromResponse(text)
    expect(result.cleanedText).toBe('Some text before')
    expect(result.cleanedText).not.toContain('memory_extract')
  })

  it('should handle empty JSON array', () => {
    const text = 'Response <memory_extract>[]</memory_extract>'
    const result = parseMemoryFromResponse(text)
    expect(result.facts).toEqual([])
    expect(result.isFullReplace).toBe(true)
  })

  it('should filter out non-string and empty values', () => {
    const text = '<memory_extract>[123, "valid fact", "", null, "another fact"]</memory_extract>'
    const result = parseMemoryFromResponse(text)
    expect(result.facts).toEqual(['valid fact', 'another fact'])
  })

  it('should handle malformed JSON gracefully', () => {
    const text = '<memory_extract>not valid json</memory_extract>'
    const result = parseMemoryFromResponse(text)
    expect(result.facts).toEqual([])
    expect(result.isFullReplace).toBe(false)
  })

  it('should handle non-array JSON', () => {
    const text = '<memory_extract>{"key": "value"}</memory_extract>'
    const result = parseMemoryFromResponse(text)
    expect(result.facts).toEqual([])
    expect(result.isFullReplace).toBe(false)
  })

  it('should handle whitespace inside the tag', () => {
    const text = '<memory_extract>  \n  ["spaced fact"]  \n  </memory_extract>'
    const result = parseMemoryFromResponse(text)
    expect(result.facts).toEqual(['spaced fact'])
    expect(result.isFullReplace).toBe(true)
  })
})

// ─── extractFactsFromPatterns ───────────────────────────────────────────

describe('extractFactsFromPatterns', () => {
  // ── Original patterns ──

  describe('name patterns', () => {
    it('should extract "my name is X"', () => {
      const facts = extractFactsFromPatterns('Hey, my name is Alex.')
      expect(facts.get('name')).toBe("User's name is Alex")
    })

    it('should extract "call me X"', () => {
      const facts = extractFactsFromPatterns('Please call me Jordan')
      expect(facts.get('name')).toBe("User's name is Jordan")
    })

    it('should extract "I\'m X," with comma', () => {
      const facts = extractFactsFromPatterns("I'm Sarah, nice to meet you")
      expect(facts.get('name')).toBe("User's name is Sarah")
    })

    it('should extract "I am X." with period', () => {
      const facts = extractFactsFromPatterns('I am John.')
      expect(facts.get('name')).toBe("User's name is John")
    })
  })

  describe('workplace patterns', () => {
    it('should extract "I work at X"', () => {
      const facts = extractFactsFromPatterns('I work at Google.')
      expect(facts.get('workplace')).toBe('User works at Google')
    })

    it('should extract "I am working for X"', () => {
      const facts = extractFactsFromPatterns('I am working for Microsoft.')
      expect(facts.get('workplace')).toBe('User works at Microsoft')
    })
  })

  describe('occupation patterns', () => {
    it('should extract "I\'m a software engineer"', () => {
      const facts = extractFactsFromPatterns("I'm a software engineer")
      expect(facts.get('occupation')).toBe('User is a software engineer')
    })

    it('should extract "I am a student"', () => {
      const facts = extractFactsFromPatterns('I am a student')
      expect(facts.get('occupation')).toBe('User is a student')
    })
  })

  describe('location patterns', () => {
    it('should extract "I live in X"', () => {
      const facts = extractFactsFromPatterns('I live in New York.')
      expect(facts.get('location')).toBe('User lives in New York')
    })

    it('should extract "I\'m from X"', () => {
      const facts = extractFactsFromPatterns("I'm from London.")
      expect(facts.get('location')).toBe('User is from London')
    })
  })

  describe('age patterns', () => {
    it('should extract "I\'m 25 years old"', () => {
      const facts = extractFactsFromPatterns("I'm 25 years old")
      expect(facts.get('age')).toBe('User is 25 years old')
    })

    it('should extract "my age is 30"', () => {
      const facts = extractFactsFromPatterns('my age is 30')
      expect(facts.get('age')).toBe('User is 30 years old')
    })
  })

  describe('interest patterns', () => {
    it('should extract "I love hiking"', () => {
      const facts = extractFactsFromPatterns('I love hiking.')
      expect(facts.get('interest')).toBe('User loves hiking')
    })

    it('should extract "I enjoy cooking"', () => {
      const facts = extractFactsFromPatterns('I enjoy cooking.')
      expect(facts.get('interest')).toBe('User loves cooking')
    })
  })

  describe('tech patterns', () => {
    it('should extract "I use TypeScript"', () => {
      const facts = extractFactsFromPatterns('I use TypeScript.')
      expect(facts.get('tech')).toBe('User uses TypeScript')
    })

    it('should extract "I code in Python"', () => {
      const facts = extractFactsFromPatterns('I code in Python.')
      expect(facts.get('tech')).toBe('User uses Python')
    })
  })

  // ── New patterns ──

  describe('relationship patterns', () => {
    it('should extract "my wife is Sarah"', () => {
      const facts = extractFactsFromPatterns('my wife is Sarah')
      expect(facts.get('relationship')).toBe("User's wife is Sarah")
    })

    it('should extract "my husband is named James"', () => {
      const facts = extractFactsFromPatterns('my husband is named James')
      expect(facts.get('relationship')).toBe("User's husband is James")
    })

    it('should extract "my partner is Alex"', () => {
      const facts = extractFactsFromPatterns('my partner is Alex')
      expect(facts.get('relationship')).toBe("User's partner is Alex")
    })

    it('should extract "my girlfriend is named Emma"', () => {
      const facts = extractFactsFromPatterns('my girlfriend is named Emma')
      expect(facts.get('relationship')).toBe("User's girlfriend is Emma")
    })

    it('should extract "my boyfriend is Tom"', () => {
      const facts = extractFactsFromPatterns('my boyfriend is Tom')
      expect(facts.get('relationship')).toBe("User's boyfriend is Tom")
    })
  })

  describe('family patterns', () => {
    it('should extract "my brother is named Mike"', () => {
      const facts = extractFactsFromPatterns('my brother is named Mike')
      expect(facts.get('family')).toBe("User's brother is Mike")
    })

    it('should extract "my mom is Linda"', () => {
      const facts = extractFactsFromPatterns('my mom is Linda')
      expect(facts.get('family')).toBe("User's mom is Linda")
    })

    it('should extract "my daughter is named Lily"', () => {
      const facts = extractFactsFromPatterns('my daughter is named Lily')
      expect(facts.get('family')).toBe("User's daughter is Lily")
    })
  })

  describe('pet patterns', () => {
    it('should extract "I have a dog named Max"', () => {
      const facts = extractFactsFromPatterns('I have a dog named Max')
      expect(facts.get('pet')).toBe('User has a dog named Max')
    })

    it('should extract "I have a cat" without a name', () => {
      const facts = extractFactsFromPatterns('I have a cat.')
      expect(facts.get('pet')).toBe('User has a cat')
    })

    it('should extract "my dog is named Buddy"', () => {
      const facts = extractFactsFromPatterns("my dog's name is Buddy")
      expect(facts.get('pet')).toBe('User has a dog named Buddy')
    })

    it('should extract "I have a rabbit"', () => {
      const facts = extractFactsFromPatterns('I have a rabbit.')
      expect(facts.get('pet')).toBe('User has a rabbit')
    })
  })

  describe('education patterns', () => {
    it('should extract "I studied at MIT"', () => {
      const facts = extractFactsFromPatterns('I studied at MIT.')
      expect(facts.get('education')).toBe('User studied at MIT')
    })

    it('should extract "I study at Harvard"', () => {
      const facts = extractFactsFromPatterns('I study at Harvard.')
      expect(facts.get('education')).toBe('User studied at Harvard')
    })

    it('should extract "I graduated from Stanford"', () => {
      const facts = extractFactsFromPatterns('I graduated from Stanford.')
      expect(facts.get('education')).toBe('User graduated from/in Stanford')
    })

    it('should extract "I have a masters degree in CS"', () => {
      const facts = extractFactsFromPatterns('I have a masters degree in CS.')
      expect(facts.get('education')).toBe('User has a masters degree in CS')
    })
  })

  describe('skill patterns', () => {
    it('should extract "I\'m good at cooking"', () => {
      const facts = extractFactsFromPatterns("I'm good at cooking.")
      expect(facts.get('skill')).toBe('User is skilled in cooking')
    })

    it('should extract "I\'m proficient in Python"', () => {
      const facts = extractFactsFromPatterns("I'm proficient in Python.")
      expect(facts.get('skill')).toBe('User is skilled in Python')
    })

    it('should extract "I know how to swim"', () => {
      const facts = extractFactsFromPatterns('I know how to swim.')
      expect(facts.get('skill')).toBe('User knows how to swim')
    })
  })

  describe('project patterns', () => {
    it('should extract "I\'m working on a chat app"', () => {
      const facts = extractFactsFromPatterns("I'm working on a chat app.")
      expect(facts.get('project')).toBe('User is working on chat app')
    })

    it('should extract "I\'m building a website"', () => {
      const facts = extractFactsFromPatterns("I'm building a website.")
      expect(facts.get('project')).toBe('User is working on website')
    })

    it('should extract "my project is Ax Studio"', () => {
      const facts = extractFactsFromPatterns('my project is Ax Studio.')
      expect(facts.get('project')).toBe("User's project is Ax Studio")
    })
  })

  describe('food preference patterns', () => {
    it('should extract "I\'m vegetarian"', () => {
      const facts = extractFactsFromPatterns("I'm vegetarian")
      expect(facts.get('food_pref')).toBe('User is vegetarian')
    })

    it('should extract "I\'m vegan"', () => {
      const facts = extractFactsFromPatterns("I'm vegan")
      expect(facts.get('food_pref')).toBe('User is vegan')
    })

    it('should extract "I\'m keto"', () => {
      const facts = extractFactsFromPatterns("I'm keto")
      expect(facts.get('food_pref')).toBe('User is keto')
    })

    it('should extract "I love Italian food"', () => {
      const facts = extractFactsFromPatterns('I love Italian food')
      expect(facts.get('food_pref')).toBe('User loves Italian food')
    })
  })

  describe('allergy patterns', () => {
    it('should extract "I\'m allergic to peanuts"', () => {
      const facts = extractFactsFromPatterns("I'm allergic to peanuts.")
      expect(facts.get('allergy')).toBe('User is allergic to peanuts')
    })
  })

  describe('language patterns', () => {
    it('should extract "I speak French"', () => {
      const facts = extractFactsFromPatterns('I speak French.')
      expect(facts.get('language')).toBe('User speaks French')
    })

    it('should extract "my native language is Spanish"', () => {
      const facts = extractFactsFromPatterns('my native language is Spanish.')
      expect(facts.get('language')).toBe("User's native language is Spanish")
    })

    it('should extract "I\'m learning Japanese"', () => {
      const facts = extractFactsFromPatterns("I'm learning Japanese.")
      expect(facts.get('language_learning')).toBe('User is learning Japanese')
    })
  })

  describe('timezone patterns', () => {
    it('should extract "I\'m in EST"', () => {
      const facts = extractFactsFromPatterns("I'm in EST")
      expect(facts.get('timezone')).toBe("User's timezone is EST")
    })

    it('should extract "I\'m in PST"', () => {
      const facts = extractFactsFromPatterns("I'm in PST")
      expect(facts.get('timezone')).toBe("User's timezone is PST")
    })

    it('should extract "I\'m in IST"', () => {
      const facts = extractFactsFromPatterns("I'm in IST")
      expect(facts.get('timezone')).toBe("User's timezone is IST")
    })

    it('should extract "my timezone is UTC+5"', () => {
      const facts = extractFactsFromPatterns('my timezone is UTC+5.')
      expect(facts.get('timezone')).toBe("User's timezone is UTC+5")
    })
  })

  describe('contact info patterns', () => {
    it('should extract "my email is user@example.com"', () => {
      const facts = extractFactsFromPatterns('my email is user@example.com')
      expect(facts.get('contact_email')).toBe("User's email is user@example.com")
    })

    it('should extract "my github is octocat"', () => {
      const facts = extractFactsFromPatterns('my github is octocat')
      expect(facts.get('contact_github')).toBe("User's GitHub is octocat")
    })

    it('should extract "my twitter is @johndoe"', () => {
      const facts = extractFactsFromPatterns('my twitter is @johndoe')
      expect(facts.get('contact_twitter')).toBe("User's Twitter/X is @johndoe")
    })

    it('should extract "my x is johndoe" (without @)', () => {
      const facts = extractFactsFromPatterns('my x is johndoe')
      expect(facts.get('contact_twitter')).toBe("User's Twitter/X is @johndoe")
    })
  })

  describe('multiple extractions from one message', () => {
    it('should extract multiple categories from a single message', () => {
      const text = "My name is Alex. I live in Berlin. I'm a software developer. I'm 28 years old."
      const facts = extractFactsFromPatterns(text)
      expect(facts.get('name')).toBe("User's name is Alex")
      expect(facts.get('location')).toBe('User lives in Berlin')
      expect(facts.get('occupation')).toBe('User is a software developer')
      expect(facts.get('age')).toBe('User is 28 years old')
      expect(facts.size).toBeGreaterThanOrEqual(4)
    })

    it('should only keep the first match per category', () => {
      const text = "My name is Alex. Call me Jordan."
      const facts = extractFactsFromPatterns(text)
      // "my name is" pattern comes first in PATTERNS array
      expect(facts.get('name')).toBe("User's name is Alex")
    })
  })

  describe('no-match cases', () => {
    it('should return empty map for irrelevant text', () => {
      const facts = extractFactsFromPatterns('What is the weather today?')
      expect(facts.size).toBe(0)
    })

    it('should return empty map for empty string', () => {
      const facts = extractFactsFromPatterns('')
      expect(facts.size).toBe(0)
    })
  })
})

// ─── mergePatternFacts ──────────────────────────────────────────────────

describe('mergePatternFacts', () => {
  it('should add new facts when no existing memories', () => {
    const newFacts = new Map([['name', "User's name is Alex"]])
    const result = mergePatternFacts([], newFacts, 'thread-1')
    expect(result).toHaveLength(1)
    expect(result[0].fact).toBe("User's name is Alex")
    expect(result[0].sourceThreadId).toBe('thread-1')
    expect(result[0].id).toContain('pat-name')
  })

  it('should replace existing fact in same category', () => {
    const existing = [makeEntry({ fact: "User's name is Alex" })]
    const newFacts = new Map([['name', "User's name is Jordan"]])
    const result = mergePatternFacts(existing, newFacts, 'thread-2')
    expect(result).toHaveLength(1)
    expect(result[0].fact).toBe("User's name is Jordan")
    expect(result[0].sourceThreadId).toBe('thread-2')
  })

  it('should not modify existing if no new facts', () => {
    const existing = [makeEntry({ fact: "User's name is Alex" })]
    const result = mergePatternFacts(existing, new Map(), 'thread-1')
    expect(result).toBe(existing) // same reference
  })

  it('should add facts for new categories alongside existing', () => {
    const existing = [makeEntry({ fact: "User's name is Alex" })]
    const newFacts = new Map([['location', 'User lives in NYC']])
    const result = mergePatternFacts(existing, newFacts, 'thread-1')
    expect(result).toHaveLength(2)
    expect(result[0].fact).toBe("User's name is Alex")
    expect(result[1].fact).toBe('User lives in NYC')
  })

  it('should replace relationship category correctly', () => {
    const existing = [makeEntry({ fact: "User's wife is Sarah" })]
    const newFacts = new Map([['relationship', "User's wife is Emma"]])
    const result = mergePatternFacts(existing, newFacts, 'thread-2')
    expect(result).toHaveLength(1)
    expect(result[0].fact).toBe("User's wife is Emma")
  })

  it('should replace pet category correctly', () => {
    const existing = [makeEntry({ fact: 'User has a dog named Rex' })]
    const newFacts = new Map([['pet', 'User has a cat named Whiskers']])
    const result = mergePatternFacts(existing, newFacts, 'thread-2')
    expect(result).toHaveLength(1)
    expect(result[0].fact).toBe('User has a cat named Whiskers')
  })

  it('should replace education category correctly', () => {
    const existing = [makeEntry({ fact: 'User studied at MIT' })]
    const newFacts = new Map([['education', 'User studied at Stanford']])
    const result = mergePatternFacts(existing, newFacts, 'thread-2')
    expect(result).toHaveLength(1)
    expect(result[0].fact).toBe('User studied at Stanford')
  })

  it('should replace timezone category correctly', () => {
    const existing = [makeEntry({ fact: "User's timezone is EST" })]
    const newFacts = new Map([['timezone', "User's timezone is PST"]])
    const result = mergePatternFacts(existing, newFacts, 'thread-2')
    expect(result).toHaveLength(1)
    expect(result[0].fact).toBe("User's timezone is PST")
  })

  it('should replace contact_email correctly', () => {
    const existing = [makeEntry({ fact: "User's email is old@test.com" })]
    const newFacts = new Map([['contact_email', "User's email is new@test.com"]])
    const result = mergePatternFacts(existing, newFacts, 'thread-2')
    expect(result).toHaveLength(1)
    expect(result[0].fact).toBe("User's email is new@test.com")
  })

  it('should replace skill category correctly', () => {
    const existing = [makeEntry({ fact: 'User is skilled in cooking' })]
    const newFacts = new Map([['skill', 'User is skilled in painting']])
    const result = mergePatternFacts(existing, newFacts, 'thread-2')
    expect(result).toHaveLength(1)
    expect(result[0].fact).toBe('User is skilled in painting')
  })

  it('should replace project category correctly', () => {
    const existing = [makeEntry({ fact: 'User is working on a chatbot' })]
    const newFacts = new Map([['project', 'User is working on a website']])
    const result = mergePatternFacts(existing, newFacts, 'thread-2')
    expect(result).toHaveLength(1)
    expect(result[0].fact).toBe('User is working on a website')
  })

  it('should replace food_pref category correctly', () => {
    const existing = [makeEntry({ fact: 'User is vegetarian' })]
    const newFacts = new Map([['food_pref', 'User is vegan']])
    const result = mergePatternFacts(existing, newFacts, 'thread-2')
    expect(result).toHaveLength(1)
    expect(result[0].fact).toBe('User is vegan')
  })

  it('should replace language category correctly', () => {
    const existing = [makeEntry({ fact: 'User speaks French' })]
    const newFacts = new Map([['language', 'User speaks Spanish']])
    const result = mergePatternFacts(existing, newFacts, 'thread-2')
    expect(result).toHaveLength(1)
    expect(result[0].fact).toBe('User speaks Spanish')
  })

  it('should replace contact_github correctly', () => {
    const existing = [makeEntry({ fact: "User's github is olduser" })]
    const newFacts = new Map([['contact_github', "User's GitHub is newuser"]])
    const result = mergePatternFacts(existing, newFacts, 'thread-2')
    expect(result).toHaveLength(1)
    expect(result[0].fact).toBe("User's GitHub is newuser")
  })
})

// ─── buildMemoryContext ─────────────────────────────────────────────────

describe('buildMemoryContext', () => {
  it('should include memory facts in context', () => {
    const memories = [
      makeEntry({ fact: "User's name is Alex" }),
      makeEntry({ fact: 'User lives in NYC' }),
    ]
    const result = buildMemoryContext(memories)
    expect(result).toContain('## Memory')
    expect(result).toContain("- User's name is Alex")
    expect(result).toContain('- User lives in NYC')
  })

  it('should include extraction instructions', () => {
    const result = buildMemoryContext([])
    expect(result).toContain('## Memory Extraction')
    expect(result).toContain('<memory_extract>')
  })

  it('should include extraction instructions even with no memories', () => {
    const result = buildMemoryContext([])
    expect(result).toContain('Memory Extraction')
    expect(result).not.toContain('## Memory\n')
  })

  it('should include both memory section and extraction for non-empty memories', () => {
    const memories = [makeEntry({ fact: 'Test fact' })]
    const result = buildMemoryContext(memories)
    expect(result).toContain('## Memory')
    expect(result).toContain('- Test fact')
    expect(result).toContain('## Memory Extraction')
  })
})
