import type { ResearchSource } from '@/hooks/research/useResearchPanel'

/**
 * Ask the model to decompose the user's query into `breadth` sub-questions.
 * Returns a JSON array of strings.
 */
export function PLANNER_PROMPT(query: string, breadth: number): string {
  return `/no_think
You are a research planner. Decompose the following research query into exactly ${breadth} focused sub-questions that together will fully answer it. Make each sub-question specific and distinct — avoid overlap.

Research query: "${query}"

Respond ONLY with a JSON array of ${breadth} strings. No markdown, no explanation, no extra text.
Example format: ["sub-question 1", "sub-question 2", "sub-question 3"]`
}

/**
 * Ask the model to summarise a scraped page in relation to the research question.
 * Returns plain prose ≤500 words.
 */
export function SUMMARISE_PROMPT(question: string, pageText: string): string {
  return `/no_think
Summarise the page below to answer the research question. Be concise (≤200 words). Include key facts, figures, and dates. If no relevant information, reply "No relevant information found."

Question: "${question}"

Page:
---
${pageText.slice(0, 3000)}
---`
}

/**
 * Given summaries already collected, produce follow-up sub-questions for deeper research.
 * Returns a JSON array of strings.
 */
export function DRILL_DOWN_PROMPT(question: string, summaries: string[]): string {
  const context = summaries.slice(0, 10).join('\n\n---\n\n')
  return `/no_think
You are a research analyst. Based on the summaries below collected while researching "${question}", identify 2 important follow-up questions that would deepen understanding and fill gaps in the current research.

Summaries:
---
${context.slice(0, 6000)}
---

Respond ONLY with a JSON array of 2 strings. No markdown, no explanation.
Example: ["follow-up question 1", "follow-up question 2"]`
}

/**
 * Ask the model to write a long-form research report with numbered citations.
 */
export function WRITER_PROMPT(
  query: string,
  contextBlocks: string[],
  sources: ResearchSource[]
): string {
  const sourceList = sources
    .map((s, i) => `[${i + 1}] ${s.title || s.url} — ${s.url}`)
    .join('\n')

  const context = contextBlocks.slice(0, 100).join('\n\n---\n\n')

  return `/no_think
You are an expert research writer. Using the numbered research summaries below, write a comprehensive, well-structured report that fully answers the query. Complete every section — do not stop early.

Query: "${query}"

Research summaries (each is labeled [N] — use that number as the inline citation):
---
${context.slice(0, 14000)}
---

Source index for reference:
${sourceList}

Instructions:
- Write clear, professional prose with markdown headings (##, ###) and sub-headings
- Every factual claim MUST be backed by an inline [N] citation matching the summary label above
- Cite every summary that contributed useful information
- Aim for 1800–2500 words; be thorough but finish every section
- Structure:
  ## Executive Summary (100–150 words)
  ## Background & Context
  ## Key Findings (3–5 sub-sections with ###)
  ## Analysis & Implications
  ## Conclusion (150+ words)
- Use bullet points and lists where helpful
- If a summary says "No relevant information found", skip its citation
- Do NOT include a Sources or References section — sources are shown separately
- CRITICAL: Write the Conclusion section completely before stopping`
}
