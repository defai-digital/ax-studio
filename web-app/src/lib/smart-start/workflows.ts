import {
  Search,
  PenTool,
  BarChart3,
  GitCompare,
  ListFilter,
  Languages,
  type LucideIcon,
} from 'lucide-react'

export type FieldType = 'text' | 'textarea' | 'radio'

export interface WorkflowField {
  id: string
  label: string
  type: FieldType
  placeholder?: string
  required?: boolean
  options?: Array<{ value: string; label: string }>
}

export interface SmartStartWorkflow {
  id: string
  icon: LucideIcon
  label: string
  description: string
  color: string
  tag: string
  fields: WorkflowField[]
  /** Build the final prompt from user's form values */
  buildPrompt: (values: Record<string, string>) => string
}

export const SMART_START_WORKFLOWS: SmartStartWorkflow[] = [
  {
    id: 'research',
    icon: Search,
    label: 'Research & Summarize',
    description: 'Find and summarize information about a topic',
    color: 'violet',
    tag: 'Research',
    fields: [
      { id: 'topic', label: 'What topic?', type: 'text', placeholder: 'e.g., AI trends in healthcare 2026', required: true },
      {
        id: 'depth', label: 'How deep?', type: 'radio',
        options: [
          { value: 'quick', label: 'Quick overview' },
          { value: 'detailed', label: 'Detailed report' },
          { value: 'deep', label: 'Deep dive' },
        ],
      },
      {
        id: 'format', label: 'Output format', type: 'radio',
        options: [
          { value: 'summary', label: 'Summary' },
          { value: 'bullets', label: 'Bullet points' },
          { value: 'report', label: 'Full report' },
        ],
      },
    ],
    buildPrompt: (v) => {
      const depth = v.depth === 'deep' ? 'comprehensive deep dive' : v.depth === 'detailed' ? 'detailed report' : 'quick overview'
      const format = v.format === 'report' ? 'Write a full report with sections.' : v.format === 'bullets' ? 'Use bullet points.' : 'Write a concise summary.'
      return `Research the topic: "${v.topic}"\n\nProvide a ${depth}. ${format} Include sources for key claims.`
    },
  },
  {
    id: 'write',
    icon: PenTool,
    label: 'Write & Edit',
    description: 'Help write or improve a document',
    color: 'emerald',
    tag: 'Write',
    fields: [
      {
        id: 'type', label: 'What type?', type: 'radio',
        options: [
          { value: 'email', label: 'Email' },
          { value: 'report', label: 'Report' },
          { value: 'blog', label: 'Blog post' },
          { value: 'letter', label: 'Letter' },
          { value: 'other', label: 'Other' },
        ],
      },
      { id: 'topic', label: 'About what?', type: 'text', placeholder: 'e.g., Project status update for Q1', required: true },
      {
        id: 'tone', label: 'Tone', type: 'radio',
        options: [
          { value: 'professional', label: 'Professional' },
          { value: 'casual', label: 'Casual' },
          { value: 'formal', label: 'Formal' },
        ],
      },
      { id: 'context', label: 'Any context or notes?', type: 'textarea', placeholder: 'Key points to include, audience, etc.' },
    ],
    buildPrompt: (v) => {
      const type = v.type === 'other' ? 'document' : v.type
      const tone = v.tone ? ` Use a ${v.tone} tone.` : ''
      const context = v.context ? `\n\nContext: ${v.context}` : ''
      return `Write a ${type} about: "${v.topic}"${tone}${context}`
    },
  },
  {
    id: 'analyze',
    icon: BarChart3,
    label: 'Analyze',
    description: 'Look at data or a document and provide insights',
    color: 'cyan',
    tag: 'Analyze',
    fields: [
      { id: 'subject', label: 'What to analyze?', type: 'text', placeholder: 'e.g., Sales data for Q1 2026', required: true },
      { id: 'focus', label: 'Focus areas', type: 'textarea', placeholder: 'e.g., Trends, outliers, key metrics' },
      {
        id: 'format', label: 'Output format', type: 'radio',
        options: [
          { value: 'insights', label: 'Key insights' },
          { value: 'report', label: 'Full analysis' },
          { value: 'chart', label: 'With charts' },
        ],
      },
    ],
    buildPrompt: (v) => {
      const focus = v.focus ? `\nFocus on: ${v.focus}` : ''
      const format = v.format === 'chart' ? ' Include data visualizations.' : v.format === 'report' ? ' Provide a full analysis with sections.' : ' List the key insights.'
      return `Analyze: "${v.subject}"${focus}${format}`
    },
  },
  {
    id: 'compare',
    icon: GitCompare,
    label: 'Compare',
    description: 'Compare options, documents, or approaches',
    color: 'amber',
    tag: 'Compare',
    fields: [
      { id: 'items', label: 'What to compare?', type: 'textarea', placeholder: 'e.g., React vs Vue vs Svelte for a small team', required: true },
      { id: 'criteria', label: 'Criteria', type: 'text', placeholder: 'e.g., ease of use, performance, community' },
      {
        id: 'format', label: 'Output format', type: 'radio',
        options: [
          { value: 'table', label: 'Comparison table' },
          { value: 'prose', label: 'Detailed discussion' },
          { value: 'recommendation', label: 'With recommendation' },
        ],
      },
    ],
    buildPrompt: (v) => {
      const criteria = v.criteria ? `\nCompare on: ${v.criteria}` : ''
      const format = v.format === 'table' ? ' Present as a comparison table.' : v.format === 'recommendation' ? ' End with a clear recommendation.' : ' Discuss the trade-offs in detail.'
      return `Compare the following: ${v.items}${criteria}${format}`
    },
  },
  {
    id: 'extract',
    icon: ListFilter,
    label: 'Extract & Organize',
    description: 'Pull out key information and structure it',
    color: 'rose',
    tag: 'Extract',
    fields: [
      { id: 'source', label: 'From what?', type: 'textarea', placeholder: 'Paste text, describe a document, or reference uploaded files', required: true },
      { id: 'what', label: 'What to extract?', type: 'text', placeholder: 'e.g., action items, key dates, main arguments' },
      {
        id: 'format', label: 'Output format', type: 'radio',
        options: [
          { value: 'list', label: 'Bullet list' },
          { value: 'table', label: 'Table' },
          { value: 'structured', label: 'Structured sections' },
        ],
      },
    ],
    buildPrompt: (v) => {
      const what = v.what ? `Extract: ${v.what}` : 'Extract the key points'
      const format = v.format === 'table' ? ' Organize in a table.' : v.format === 'structured' ? ' Organize into sections.' : ' Present as a bullet list.'
      return `${what} from the following:\n\n${v.source}\n\n${format}`
    },
  },
  {
    id: 'translate',
    icon: Languages,
    label: 'Translate & Adapt',
    description: 'Translate content and adapt tone for another audience',
    color: 'indigo',
    tag: 'Translate',
    fields: [
      { id: 'content', label: 'Content to translate', type: 'textarea', placeholder: 'Paste the text to translate', required: true },
      { id: 'language', label: 'Target language', type: 'text', placeholder: 'e.g., Traditional Chinese, Spanish, Japanese', required: true },
      {
        id: 'style', label: 'Adaptation', type: 'radio',
        options: [
          { value: 'literal', label: 'Direct translation' },
          { value: 'natural', label: 'Natural & fluent' },
          { value: 'localized', label: 'Fully localized' },
        ],
      },
    ],
    buildPrompt: (v) => {
      const style = v.style === 'localized' ? 'Fully localize the content for the target audience — adapt idioms, references, and cultural context.' :
        v.style === 'natural' ? 'Translate naturally and fluently, adapting phrasing for the target language.' :
        'Translate directly, preserving the original structure.'
      return `Translate the following to ${v.language}:\n\n${v.content}\n\n${style}`
    },
  },
]
