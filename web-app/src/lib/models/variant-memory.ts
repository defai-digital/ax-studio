/**
 * variant-memory — S1.2 Hub memory estimates and human compatibility labels.
 *
 * Estimates the runtime memory a model variant needs from its file size:
 * - GGUF: file size × ~1.2 (weights + KV cache + context overhead).
 * - MLX: file size × ~1.0 (weights map directly into unified memory).
 *
 * The estimate is compared against the machine's total RAM (same hardware
 * telemetry source as the Hardware settings page, `useHardware`) to derive a
 * one-line label:
 * - 'Recommended'           — estimate fits comfortably (≤ 60% of RAM)
 * - 'Fits with tight memory'— estimate fits, with little headroom (≤ 85%)
 * - 'Exceeds your RAM'      — estimate is larger than what is safely usable
 *
 * When hardware info is unavailable, callers get `null` and should degrade
 * to showing only the raw file size.
 */

export type VariantMemoryLabel =
  | 'Recommended'
  | 'Fits with tight memory'
  | 'Exceeds your RAM'

export type VariantMemoryInfo = {
  estimatedGB: number
  estimatedText: string
  label: VariantMemoryLabel
}

export const GGUF_MEMORY_FACTOR = 1.2
export const MLX_MEMORY_FACTOR = 1.0
export const RECOMMENDED_MAX_RATIO = 0.6
export const FITS_MAX_RATIO = 0.85

/**
 * Parse catalog `file_size` strings (produced by `formatFileSize` in
 * services/models/default.ts, e.g. "512.0 MB" / "3.3 GB") into GB.
 */
export const parseFileSizeGB = (fileSize?: string): number | null => {
  if (!fileSize) return null
  const match = fileSize.trim().match(/^(\d+(?:\.\d+)?)\s*(kb|mb|gb|tb)$/i)
  if (!match) return null

  const value = Number.parseFloat(match[1])
  if (!Number.isFinite(value) || value <= 0) return null

  switch (match[2].toLowerCase()) {
    case 'tb':
      return value * 1024
    case 'gb':
      return value
    case 'mb':
      return value / 1024
    default:
      return value / (1024 * 1024)
  }
}

export const estimateVariantMemoryGB = (
  fileSizeGB: number,
  isMlx: boolean
): number => fileSizeGB * (isMlx ? MLX_MEMORY_FACTOR : GGUF_MEMORY_FACTOR)

export const getVariantMemoryLabel = (
  estimatedGB: number,
  totalMemoryGB: number
): VariantMemoryLabel => {
  const ratio = estimatedGB / totalMemoryGB
  if (ratio <= RECOMMENDED_MAX_RATIO) return 'Recommended'
  if (ratio <= FITS_MAX_RATIO) return 'Fits with tight memory'
  return 'Exceeds your RAM'
}

/** Label colors matching the green/yellow/red compatibility-dot palette. */
export const VARIANT_MEMORY_LABEL_CLASSES: Record<
  VariantMemoryLabel,
  string
> = {
  Recommended: 'text-emerald-500',
  'Fits with tight memory': 'text-amber-500',
  'Exceeds your RAM': 'text-red-500',
}

const formatEstimatedGB = (estimatedGB: number): string =>
  `≈ ${estimatedGB >= 10 ? Math.round(estimatedGB) : estimatedGB.toFixed(1)} GB`

/**
 * Estimate runtime memory for a variant and derive its label.
 *
 * @param fileSize      catalog file size string, e.g. "3.3 GB"
 * @param isMlx         whether the variant is MLX (vs GGUF)
 * @param totalMemoryMB machine total RAM in MB (`hardwareData.total_memory`);
 *                      pass 0/NaN when hardware info is unavailable.
 * @returns `null` when the size is unknown or hardware info is unavailable.
 */
export const getVariantMemoryInfo = (
  fileSize: string | undefined,
  isMlx: boolean,
  totalMemoryMB: number
): VariantMemoryInfo | null => {
  if (!Number.isFinite(totalMemoryMB) || totalMemoryMB <= 0) return null

  const fileSizeGB = parseFileSizeGB(fileSize)
  if (fileSizeGB === null) return null

  const estimatedGB = estimateVariantMemoryGB(fileSizeGB, isMlx)
  return {
    estimatedGB,
    estimatedText: formatEstimatedGB(estimatedGB),
    label: getVariantMemoryLabel(estimatedGB, totalMemoryMB / 1024),
  }
}
