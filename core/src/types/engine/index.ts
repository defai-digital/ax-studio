/**
 * Secure string wrapper to prevent accidental exposure of sensitive data
 */
export class SecretString {
  private readonly value: string

  constructor(value: string) {
    this.value = value
  }

  /**
   * Get the secret value - use sparingly and never log
   */
  getValue(): string {
    return this.value
  }

  /**
   * Check if the secret has a value
   */
  hasValue(): boolean {
    return this.value.length > 0
  }

  /**
   * Get a masked representation for safe logging
   */
  toString(): string {
    if (this.value.length === 0) return ''
    if (this.value.length <= 2) return '*'.repeat(this.value.length)
    return this.value[0] + '*'.repeat(this.value.length - 2) + this.value[this.value.length - 1]
  }

  /**
   * Serialization hook used by JSON.stringify — returns the masked string
   * so secrets are never accidentally persisted to storage or logs.
   */
  toJSON(): string {
    return this.toString()
  }

  /**
   * Create from plain string
   */
  static from(value: string): SecretString {
    return new SecretString(value)
  }
}

/**
 * Validate template strings to prevent injection attacks
 * Only allows safe template patterns with placeholders
 */
export function validateTemplate(template: string): boolean {
  if (!template || template.trim().length === 0) {
    return true // Empty templates are safe
  }

  // Only allow common placeholders like {{variable}}, ${variable}, %variable%, etc.
  const allowedPatternSources = [
    String.raw`\{\{[\w.]+\}\}`, // {{variable}} or {{object.property}}
    String.raw`\$\{[\w.]+\}`,   // ${variable} or ${object.property}
    String.raw`%[\w.]+%`,       // %variable% or %object.property%
    String.raw`\{\w+\}`,        // {variable}
  ]

  if (/\{\{\{|\}\}\}/.test(template)) {
    return false
  }

  const cleanedDoubleBraceTemplate = template.replace(/\{\{[\w.]+\}\}/g, '')
  if (/\{\{|\}\}/.test(cleanedDoubleBraceTemplate)) {
    return false
  }

  const cleanedDollarBraceTemplate = template.replace(/\$\{[\w.]+\}/g, '')
  if (/\$\{/.test(cleanedDollarBraceTemplate)) {
    return false
  }

  // Check for potentially dangerous patterns
  const dangerousPatterns = [
    /<script/i,         // Script tags
    /javascript:/i,     // JavaScript URLs
    /on\w+\s*=/i,       // Event handlers
    /eval\s*\(/i,       // eval calls
    /Function\s*\(/i,   // Function constructor
    /require\s*\(/i,    // require calls
    /import\s*\(/i,     // import calls
  ]

  // Remove all allowed patterns and check if anything dangerous remains
  let cleanedTemplate = template

  // Remove allowed patterns
  allowedPatternSources.forEach(source => {
    cleanedTemplate = cleanedTemplate.replace(new RegExp(source, 'g'), '')
  })

  // Check for dangerous patterns in the cleaned template
  for (const pattern of dangerousPatterns) {
    if (pattern.test(cleanedTemplate)) {
      return false
    }
  }

  // Additional check: ensure template doesn't contain executable code structures.
  // Patterns are narrowed to code-shaped sequences (e.g. `function foo(` or
  // `const x =`) to avoid false positives on natural-language prompt text like
  // "define a function that..." or "temperature = 0.7".
  const codePatterns = [
    /\b(function|class)\s+\w+\s*[({]/i,     // function foo( / class Foo {
    /\b(const|let|var)\s+\w+\s*=/i,         // const x = / let y = / var z =
    /=>\s*[{(]/,                             // arrow function bodies
    /;\s*[a-zA-Z_$][\w$]*\s*\([^)]*\)\s*;/, // chained statement calls
  ]

  for (const pattern of codePatterns) {
    if (pattern.test(cleanedTemplate)) {
      return false
    }
  }

  return true
}

/**
 * Branded type for validated templates to ensure security
 */
export type ValidatedTemplate = string & { readonly __validatedTemplate: true }

/**
 * Create a validated template - throws if validation fails
 */
export function createValidatedTemplate(template: string): ValidatedTemplate {
  if (!validateTemplate(template)) {
    throw new Error('Template contains potentially unsafe patterns')
  }
  return template as ValidatedTemplate
}

export type Engines = {
  [key: string]: (EngineVariant & EngineConfig)[]
}

export type EngineMetadata = {
  get_models_url?: string
  header_template?: string
  transform_req?: {
    chat_completions?: {
      url?: string
      /**
       * Template string for request transformation
       * @security Must be validated with validateTemplate() before use to prevent injection
       */
      template?: ValidatedTemplate
    }
  }
  transform_resp?: {
    chat_completions?: {
      /**
       * Template string for response transformation
       * @security Must be validated with validateTemplate() before use to prevent injection
       */
      template?: ValidatedTemplate
    }
  }
  explore_models_url?: string
}

export type EngineVariant = {
  engine: string
  name: string
  version: string
}

export type DefaultEngineVariant = {
  engine: string
  variant: string
  version: string
}

export type EngineReleased = {
  created_at: string
  download_count: number
  name: string
  size: number
}

export type EngineConfig = {
  engine?: string
  version?: string
  variant?: string
  type?: string
  url?: string
  api_key?: SecretString
  metadata?: EngineMetadata
}

export enum EngineEvent {
  OnEngineUpdate = 'OnEngineUpdate',
}
