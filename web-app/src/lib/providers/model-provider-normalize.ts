/**
 * Pure normalization utilities for model provider data.
 * No service hub or runtime dependencies — fully unit-testable.
 */

/**
 * Returns only models with a valid string id or model field.
 */
export function filterValidModels<T extends { id?: string; model?: string }>(
  models: T[]
): T[] {
  return models.filter(
    (e) => ('id' in e || 'model' in e) && typeof (e.id ?? e.model) === 'string'
  )
}
