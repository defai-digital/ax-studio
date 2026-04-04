export interface ExaResult {
  id?: string
  url: string
  title?: string
  text?: string
  snippet?: string
  highlights?: string[]
  score?: number
  publishedDate?: string
  author?: string
}

export interface MCPContent {
  type?: string
  text: string
}

export interface MCPToolCallResult {
  error: string
  content: MCPContent[]
}

export interface NativeSearchResult {
  url: string
  title: string
  snippet: string
}

export interface WikiSearchResult {
  title: string
  snippet: string
  pageid: number
}
