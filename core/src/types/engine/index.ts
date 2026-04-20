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
   * WARNING: Returns the **masked** string (e.g. "s***g"), NOT the raw secret.
   * Using JSON.stringify on a SecretString will DESTROY the original value.
   * Use `toRaw()` if you need the plaintext for persistence.
   */
  toJSON(): string {
    return this.toString()
  }

  /**
   * Explicitly unwrap the raw value for serialization/persistence.
   * Prefer this over getValue() when building JSON payloads to make
   * the intent clear at the call site.
   */
  toRaw(): string {
    return this.value
  }

  /**
   * Create from plain string
   */
  static from(value: string): SecretString {
    return new SecretString(value)
  }
}

