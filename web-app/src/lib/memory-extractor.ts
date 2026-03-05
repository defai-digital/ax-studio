import type { MemoryEntry } from '@/hooks/useMemory'

/**
 * System prompt suffix that instructs the LLM to extract facts inline.
 * The LLM outputs ALL current facts (including corrections) in <memory_extract> tags.
 * Client-side pattern matching runs as a reliable fallback.
 */
const EXTRACTION_INSTRUCTION = `

## Memory Extraction
When the user shares personal information about themselves (name, job, location, preferences, interests, skills, projects, relationships, etc.), you must update the memory.

Include a <memory_extract> tag at the VERY END of your response with ALL facts you know about the user — both from the Memory section above AND any new or corrected facts from this conversation.

Format:
<memory_extract>["fact1", "fact2", "fact3"]</memory_extract>

Rules:
- Include ALL current facts — this list REPLACES the existing memory entirely
- If the user corrects a fact (e.g. "my name is actually John"), include the CORRECTED version, not the old one
- Each fact should be a concise sentence (e.g. "User's name is Alex", "User works at Google")
- Only include concrete FACTS, not opinions or transient info
- If there are no new or changed facts in this conversation, do NOT include the tag at all
- The tag must be the very last thing in your response
- Do NOT mention the memory extraction to the user — it should be invisible to them`

export type MemoryParseResult = {
  facts: string[]
  isFullReplace: boolean
  cleanedText: string
}

/**
 * Parse <memory_extract> tags from the assistant response.
 * Returns the full list of facts (replaces all existing memories).
 */
export function parseMemoryFromResponse(text: string): MemoryParseResult {
  const match = text.match(/<memory_extract>\s*([\s\S]*?)\s*<\/memory_extract>/)
  if (!match) {
    return { facts: [], isFullReplace: false, cleanedText: text }
  }

  const cleanedText = text.replace(/<memory_extract>[\s\S]*?<\/memory_extract>/, '').trimEnd()

  try {
    const jsonStr = match[1].trim()
    const parsed = JSON.parse(jsonStr)

    if (Array.isArray(parsed)) {
      const facts = parsed.filter((f: unknown) => typeof f === 'string' && (f as string).trim().length > 0) as string[]
      if (facts.length > 0) {
        console.log('[Memory] Full memory replace with facts:', facts)
      }
      return { facts, isFullReplace: true, cleanedText }
    }

    return { facts: [], isFullReplace: false, cleanedText }
  } catch (error) {
    console.warn('[Memory] Failed to parse memory_extract JSON:', error)
    return { facts: [], isFullReplace: false, cleanedText }
  }
}

// ── Client-side pattern matching (reliable fallback) ──────────────────────

type PatternRule = {
  pattern: RegExp
  category: string
  template: (match: RegExpMatchArray) => string
}

const PATTERNS: PatternRule[] = [
  // Name patterns
  { pattern: /\bmy name is ([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)*)/i, category: 'name', template: (m) => `User's name is ${m[1]}` },
  { pattern: /\bcall me ([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)*)/i, category: 'name', template: (m) => `User's name is ${m[1]}` },
  { pattern: /\bi'm ([A-Z][a-zA-Z]+)(?:\s*[,.]|\s+and\b)/i, category: 'name', template: (m) => `User's name is ${m[1]}` },
  { pattern: /\bI am ([A-Z][a-zA-Z]+)(?:\s*[,.]|\s+and\b)/i, category: 'name', template: (m) => `User's name is ${m[1]}` },

  // Job/occupation
  { pattern: /\bi (?:work|am working) (?:at|for) ([A-Z][\w\s&.]+?)(?:\s+as\b|\s*[,.]|$)/im, category: 'workplace', template: (m) => `User works at ${m[1].trim()}` },
  { pattern: /\bi'm (?:a|an) ([\w\s]*(?:engineer|developer|designer|manager|scientist|analyst|teacher|doctor|nurse|lawyer|architect|consultant|writer|artist|student|intern|founder|ceo|cto))/i, category: 'occupation', template: (m) => `User is a ${m[1].trim()}` },
  { pattern: /\bi am (?:a|an) ([\w\s]*(?:engineer|developer|designer|manager|scientist|analyst|teacher|doctor|nurse|lawyer|architect|consultant|writer|artist|student|intern|founder|ceo|cto))/i, category: 'occupation', template: (m) => `User is a ${m[1].trim()}` },
  { pattern: /\bmy job is ([\w\s]+?)(?:\s*[,.]|$)/im, category: 'occupation', template: (m) => `User's job is ${m[1].trim()}` },

  // Location
  { pattern: /\bi (?:live|am living|reside) in ([A-Z][\w\s,]+?)(?:\s*[,.]|$)/im, category: 'location', template: (m) => `User lives in ${m[1].trim()}` },
  { pattern: /\bi'm from ([A-Z][\w\s,]+?)(?:\s*[,.]|$)/im, category: 'location', template: (m) => `User is from ${m[1].trim()}` },
  { pattern: /\bi am from ([A-Z][\w\s,]+?)(?:\s*[,.]|$)/im, category: 'location', template: (m) => `User is from ${m[1].trim()}` },

  // Age
  { pattern: /\bi'm (\d{1,3}) years old/i, category: 'age', template: (m) => `User is ${m[1]} years old` },
  { pattern: /\bi am (\d{1,3}) years old/i, category: 'age', template: (m) => `User is ${m[1]} years old` },
  { pattern: /\bmy age is (\d{1,3})/i, category: 'age', template: (m) => `User is ${m[1]} years old` },

  // Interests/hobbies
  { pattern: /\bi (?:love|enjoy|like) (?:to )?([\w\s]+?)(?:\s*[,.]|$)/im, category: 'interest', template: (m) => `User loves ${m[1].trim()}` },
  { pattern: /\bmy (?:hobby|hobbies|passion) (?:is|are) ([\w\s,]+?)(?:\s*[.]|$)/im, category: 'hobby', template: (m) => `User's hobby is ${m[1].trim()}` },

  // Programming languages / tech
  { pattern: /\bi (?:use|code in|program in|develop with) ([\w\s,+#]+?)(?:\s+(?:for|at|and)\b|\s*[,.]|$)/im, category: 'tech', template: (m) => `User uses ${m[1].trim()}` },
  { pattern: /\bmy (?:favorite|preferred) (?:language|framework|tool) is ([\w\s.+#]+?)(?:\s*[,.]|$)/im, category: 'fav_tech', template: (m) => `User's favorite tool/language is ${m[1].trim()}` },

  // Relationships
  { pattern: /\bmy (wife|husband|partner|spouse|girlfriend|boyfriend) (?:(?:is )?named |is )([A-Z][\w]+)/i, category: 'relationship', template: (m) => `User's ${m[1].toLowerCase()} is ${m[2]}` },
  { pattern: /\bmy (brother|sister|mom|mother|dad|father|son|daughter) (?:(?:is )?named |is )([A-Z][\w]+)/i, category: 'family', template: (m) => `User's ${m[1].toLowerCase()} is ${m[2]}` },

  // Pets
  { pattern: /\bi have (?:a |an )(dog|cat|bird|fish|hamster|rabbit|parrot|turtle|snake)(?:\s+named\s+([A-Z][\w]+))?/i, category: 'pet', template: (m) => m[2] ? `User has a ${m[1].toLowerCase()} named ${m[2]}` : `User has a ${m[1].toLowerCase()}` },
  { pattern: /\bmy (dog|cat|bird|pet)(?:'s name| is called| is named) (?:is )?([A-Z][\w]+)/i, category: 'pet', template: (m) => `User has a ${m[1].toLowerCase()} named ${m[2]}` },

  // Education
  { pattern: /\bi (?:studied|study) (?:at|in) ([A-Z][\w\s&.]+?)(?:\s*[,.]|$)/im, category: 'education', template: (m) => `User studied at ${m[1].trim()}` },
  { pattern: /\bi have (?:a |an )([\w\s]+?degree[\w\s]*?)(?:\s+(?:in|from)\s+([\w\s]+?))?(?:\s*[,.]|$)/im, category: 'education', template: (m) => m[2] ? `User has a ${m[1].trim()} in ${m[2].trim()}` : `User has a ${m[1].trim()}` },
  { pattern: /\bi (?:graduated|majored) (?:from|in) ([\w\s&.]+?)(?:\s*[,.]|$)/im, category: 'education', template: (m) => `User graduated from/in ${m[1].trim()}` },

  // Skills
  { pattern: /\bi'm (?:good|great|skilled|proficient) (?:at|in|with) ([\w\s]+?)(?:\s*[,.]|$)/im, category: 'skill', template: (m) => `User is skilled in ${m[1].trim()}` },
  { pattern: /\bi know how to ([\w\s]+?)(?:\s*[,.]|$)/im, category: 'skill', template: (m) => `User knows how to ${m[1].trim()}` },

  // Projects
  { pattern: /\bi'm (?:working on|building|developing|creating) (?:a |an )?([\w\s]+?)(?:\s*[,.]|$)/im, category: 'project', template: (m) => `User is working on ${m[1].trim()}` },
  { pattern: /\bmy project is ([\w\s]+?)(?:\s*[,.]|$)/im, category: 'project', template: (m) => `User's project is ${m[1].trim()}` },

  // Food preferences
  { pattern: /\bi'm (vegetarian|vegan|pescatarian|gluten[ -]free|lactose[ -]intolerant|keto)/i, category: 'food_pref', template: (m) => `User is ${m[1].toLowerCase()}` },
  { pattern: /\bi (?:love|really like|prefer) ([\w\s]+?) (?:food|cuisine)/i, category: 'food_pref', template: (m) => `User loves ${m[1].trim()} food` },
  { pattern: /\bi'm allergic to ([\w\s]+?)(?:\s*[,.]|$)/im, category: 'allergy', template: (m) => `User is allergic to ${m[1].trim()}` },

  // Languages
  { pattern: /\bi speak ([\w\s,]+?)(?:\s*[,.]|$)/im, category: 'language', template: (m) => `User speaks ${m[1].trim()}` },
  { pattern: /\bi'm learning ([\w\s]+?)(?:\s*[,.]|$)/im, category: 'language_learning', template: (m) => `User is learning ${m[1].trim()}` },
  { pattern: /\bmy (?:native|first) language is ([\w\s]+?)(?:\s*[,.]|$)/im, category: 'language', template: (m) => `User's native language is ${m[1].trim()}` },

  // Timezone
  { pattern: /\bi'm in ((?:EST|CST|MST|PST|UTC|GMT|IST|CET|CEST|AEST|JST|KST)(?:[+-]\d{1,2})?)/i, category: 'timezone', template: (m) => `User's timezone is ${m[1]}` },
  { pattern: /\bmy timezone is ([\w\s/+-]+?)(?:\s*[,.]|$)/im, category: 'timezone', template: (m) => `User's timezone is ${m[1].trim()}` },

  // Contact info
  { pattern: /\bmy email is ([\w.+-]+@[\w.-]+\.\w+)/i, category: 'contact_email', template: (m) => `User's email is ${m[1]}` },
  { pattern: /\bmy github is ([\w.-]+)/i, category: 'contact_github', template: (m) => `User's GitHub is ${m[1]}` },
  { pattern: /\bmy (?:twitter|x) is @?([\w]+)/i, category: 'contact_twitter', template: (m) => `User's Twitter/X is @${m[1]}` },
]

/**
 * Extract facts from user text using pattern matching.
 * Returns facts keyed by category so duplicates can be replaced.
 */
export function extractFactsFromPatterns(userText: string): Map<string, string> {
  const found = new Map<string, string>()

  for (const rule of PATTERNS) {
    const match = userText.match(rule.pattern)
    if (match) {
      const fact = rule.template(match)
      // Only keep the first match per category (most specific)
      if (!found.has(rule.category)) {
        found.set(rule.category, fact)
      }
    }
  }

  return found
}

/**
 * Merge pattern-extracted facts into existing memories.
 * Replaces facts with matching categories, adds new ones.
 */
export function mergePatternFacts(
  existing: MemoryEntry[],
  newFacts: Map<string, string>,
  threadId: string
): MemoryEntry[] {
  if (newFacts.size === 0) return existing

  const now = Date.now()
  const result = [...existing]

  // Build a category map for existing entries by checking which pattern categories they match
  for (const [category, newFact] of newFacts) {
    // Check if an existing memory covers the same category
    let replaced = false
    for (let i = 0; i < result.length; i++) {
      const existingFact = result[i].fact.toLowerCase()
      const categoryMatch = isSameCategory(category, existingFact)
      if (categoryMatch) {
        // Replace the existing fact
        result[i] = {
          ...result[i],
          fact: newFact,
          category,
          sourceThreadId: threadId,
          updatedAt: now,
        }
        replaced = true
        console.log(`[Memory] Updated "${result[i].fact}" → "${newFact}"`)
        break
      }
    }
    if (!replaced) {
      result.push({
        id: `mem-${now}-pat-${category}`,
        fact: newFact,
        category,
        sourceThreadId: threadId,
        createdAt: now,
        updatedAt: now,
      })
      console.log(`[Memory] Added new fact: "${newFact}"`)
    }
  }

  return result
}

/**
 * Check if an existing fact covers the same category.
 */
function isSameCategory(category: string, existingFact: string): boolean {
  switch (category) {
    case 'name':
      return existingFact.includes("user's name is") || existingFact.includes('user name is')
    case 'workplace':
      return existingFact.includes('user works at') || existingFact.includes('works for')
    case 'occupation':
      return existingFact.includes('user is a ') && (
        existingFact.includes('engineer') || existingFact.includes('developer') ||
        existingFact.includes('designer') || existingFact.includes('student') ||
        existingFact.includes('manager') || existingFact.includes('doctor') ||
        existingFact.includes("user's job") || existingFact.includes('user is a')
      )
    case 'location':
      return existingFact.includes('user lives in') || existingFact.includes('user is from')
    case 'age':
      return existingFact.includes('years old') || existingFact.includes("user's age")
    case 'interest':
      return existingFact.includes('user loves') || existingFact.includes('user enjoys') || existingFact.includes('user likes')
    case 'hobby':
      return existingFact.includes("user's hobby") || existingFact.includes('user hobbies')
    case 'tech':
      return existingFact.includes('user uses') || existingFact.includes('user codes in')
    case 'fav_tech':
      return existingFact.includes("user's favorite") || existingFact.includes("user's preferred")
    case 'relationship':
      return existingFact.includes("user's wife") || existingFact.includes("user's husband") ||
        existingFact.includes("user's partner") || existingFact.includes("user's spouse") ||
        existingFact.includes("user's girlfriend") || existingFact.includes("user's boyfriend")
    case 'family':
      return existingFact.includes("user's brother") || existingFact.includes("user's sister") ||
        existingFact.includes("user's mom") || existingFact.includes("user's mother") ||
        existingFact.includes("user's dad") || existingFact.includes("user's father") ||
        existingFact.includes("user's son") || existingFact.includes("user's daughter")
    case 'pet':
      return existingFact.includes('user has a dog') || existingFact.includes('user has a cat') ||
        existingFact.includes('user has a bird') || existingFact.includes('user has a')
    case 'education':
      return existingFact.includes('user studied') || existingFact.includes('user has a') && existingFact.includes('degree') ||
        existingFact.includes('user graduated')
    case 'skill':
      return existingFact.includes('user is skilled') || existingFact.includes('user knows how to')
    case 'project':
      return existingFact.includes('user is working on') || existingFact.includes("user's project")
    case 'food_pref':
      return existingFact.includes('user is vegetarian') || existingFact.includes('user is vegan') ||
        existingFact.includes('user loves') && existingFact.includes('food') ||
        existingFact.includes('user is pescatarian') || existingFact.includes('user is keto')
    case 'allergy':
      return existingFact.includes('user is allergic')
    case 'language':
      return existingFact.includes('user speaks') || existingFact.includes("user's native language")
    case 'language_learning':
      return existingFact.includes('user is learning')
    case 'timezone':
      return existingFact.includes("user's timezone")
    case 'contact_email':
      return existingFact.includes("user's email")
    case 'contact_github':
      return existingFact.includes("user's github")
    case 'contact_twitter':
      return existingFact.includes("user's twitter") || existingFact.includes("user's x")
    default:
      return false
  }
}

// ── Delta-based API (used by $threadId.tsx) ─────────────────────────────

export type MemoryDeltaOp = {
  op: 'add' | 'update' | 'delete'
  fact: string
}

/**
 * Parse <memory_extract> tags and return delta operations + cleaned text.
 * Wraps parseMemoryFromResponse with a delta-op interface.
 */
export function parseMemoryDelta(text: string): {
  ops: MemoryDeltaOp[]
  cleanedText: string
} {
  const result = parseMemoryFromResponse(text)
  if (!result.isFullReplace || result.facts.length === 0) {
    return { ops: [], cleanedText: result.cleanedText }
  }
  const ops: MemoryDeltaOp[] = result.facts.map((fact) => ({
    op: 'add' as const,
    fact,
  }))
  return { ops, cleanedText: result.cleanedText }
}

/**
 * Apply delta operations to existing memories.
 * For a full-replace (all 'add' ops), replaces the entire memory set,
 * preserving existing entries that match.
 */
export function applyMemoryDelta(
  existing: MemoryEntry[],
  ops: MemoryDeltaOp[],
  threadId: string
): MemoryEntry[] {
  const now = Date.now()
  const addOps = ops.filter((o) => o.op === 'add')
  if (addOps.length === 0) return existing

  return addOps.map((op, i) => {
    const match = existing.find(
      (e) => e.fact.toLowerCase() === op.fact.toLowerCase()
    )
    if (match) return match
    return {
      id: `mem-${now}-${i}`,
      fact: op.fact,
      sourceThreadId: threadId,
      createdAt: now,
      updatedAt: now,
    }
  })
}

/**
 * Build a system prompt suffix from stored memories.
 * Includes retrieval context + extraction instruction.
 */
export function buildMemoryContext(memories: MemoryEntry[]): string {
  let suffix = ''

  if (memories.length > 0) {
    const facts = memories.map((m) => `- ${m.fact}`).join('\n')
    suffix += `\n\n## Memory\nHere are things you remember about this user:\n${facts}\n`
  }

  // Always include extraction instruction when memory is enabled
  suffix += EXTRACTION_INSTRUCTION

  return suffix
}
