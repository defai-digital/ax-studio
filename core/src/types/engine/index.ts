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
    if (this.value.length <= 4) return '*'.repeat(this.value.length)
    return this.value.substring(0, 2) + '*'.repeat(this.value.length - 4) + this.value.substring(this.value.length - 2)
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

  // Define allowed patterns for template variables
  // Only allow common placeholders like {{variable}}, ${variable}, %variable%, etc.
  const allowedPatterns = [
    /\{\{[\w.]+\}\}/g,  // {{variable}} or {{object.property}}
    /\$\{[\w.]+\}/g,    // ${variable} or ${object.property}
    /%[\w.]+%/g,        // %variable% or %object.property%
    /\{\w+\}/g,         // {variable}
  ]

  // Check for potentially dangerous patterns
  const dangerousPatterns = [
    /\{\{.*?\}\}/g,     // Any double braces (already covered above, but check for complex expressions)
    /\$\{.*?\}/g,       // Any dollar braces (already covered)
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
  allowedPatterns.forEach(pattern => {
    cleanedTemplate = cleanedTemplate.replace(pattern, '')
  })

  // Check for dangerous patterns in the cleaned template
  for (const pattern of dangerousPatterns) {
    if (pattern.test(cleanedTemplate)) {
      return false
    }
  }

  // Additional check: ensure template doesn't contain code-like structures
  const codePatterns = [
    /\b(function|class|const|let|var)\b/i,
    /[{}();]/g,  // Check for excessive braces/semicolons
  ]

  for (const pattern of codePatterns) {
    const matches = cleanedTemplate.match(pattern)
    if (matches && matches.length > 2) { // Allow minimal structural characters
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
      template?: string
    }
  }
  transform_resp?: {
    chat_completions?: {
      /**
       * Template string for response transformation
       * @security Must be validated with validateTemplate() before use to prevent injection
       */
      template?: string
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
