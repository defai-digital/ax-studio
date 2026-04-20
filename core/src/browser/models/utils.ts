type ValidationRule = (value: unknown) => boolean

export const validationRules: Record<string, ValidationRule> = {
  temperature: (v) => typeof v === 'number' && v >= 0 && v <= 2,
  token_limit: (v) => typeof v === 'number' && v >= 0,
  top_k: (v) => typeof v === 'number' && v >= 0 && v <= 1.1,
  top_p: (v) => typeof v === 'number' && v >= 0 && v <= 1,
  stream: (v) => typeof v === 'boolean',
  max_tokens: (v) => typeof v === 'number' && v >= 0,
  stop: (v) => Array.isArray(v) && v.every((s) => typeof s === 'string'),
  frequency_penalty: (v) => typeof v === 'number',
  presence_penalty: (v) => typeof v === 'number',
  ctx_len: (v) => typeof v === 'number' && v >= 0,
  ngl: (v) => typeof v === 'number' && v >= 0,
  embedding: (v) => typeof v === 'boolean',
  n_parallel: (v) => typeof v === 'number' && v >= 0,
  cpu_threads: (v) => typeof v === 'number' && v >= 0,
  prompt_template: (v) => typeof v === 'string',
  llama_model_path: (v) => typeof v === 'string',
  mmproj: (v) => typeof v === 'string',
  vision_model: (v) => typeof v === 'boolean',
  text_model: (v) => typeof v === 'boolean',
  repeat_last_n: (v) => typeof v === 'number',
  repeat_penalty: (v) => typeof v === 'number',
  min_p: (v) => typeof v === 'number',
}

const INTEGER_KEYS = new Set([
  'ctx_len', 'token_limit', 'max_tokens', 'ngl', 'n_parallel', 'cpu_threads',
])

const FLOAT_KEYS = new Set([
  'temperature', 'top_p', 'top_k', 'min_p', 'frequency_penalty',
  'presence_penalty', 'repeat_penalty', 'repeat_last_n',
])

export function normalizeValue(key: string, value: unknown): unknown {
  if (INTEGER_KEYS.has(key)) {
    if (typeof value === 'string') return parseInt(value, 10)
    if (typeof value === 'number') return Math.trunc(value)
    if (value === null) return 0
    if (value === undefined) return NaN
    return value
  }
  if (FLOAT_KEYS.has(key) && typeof value === 'string') {
    return Number(value)
  }
  return value
}

const INFERENCE_ALLOW = new Set([
  'temperature', 'token_limit', 'top_k', 'top_p', 'stream', 'max_tokens',
  'stop', 'frequency_penalty', 'presence_penalty', 'repeat_last_n', 'min_p',
  'repeat_penalty', 'engine',
])

export function extractInferenceParams(
  modelParams?: Record<string, unknown>,
  originParams?: Record<string, unknown>,
): Record<string, unknown> {
  if (!modelParams) return {}
  const result: Record<string, unknown> = {}
  for (const [key, rawValue] of Object.entries(modelParams)) {
    if (!INFERENCE_ALLOW.has(key) && !validationRules[key]) continue
    const value = normalizeValue(key, rawValue)
    if (validationRules[key]) {
      if (validationRules[key](value)) {
        result[key] = value
      } else if (originParams && key in originParams) {
        result[key] = originParams[key]
      }
    } else {
      result[key] = value
    }
  }
  return result
}

const MODEL_LOAD_ALLOW = new Set([
  'ctx_len', 'ngl', 'embedding', 'n_parallel', 'cpu_threads',
  'prompt_template', 'llama_model_path', 'mmproj', 'vision_model', 'text_model',
  'pre_prompt', 'system_prompt', 'model_path',
])

export function extractModelLoadParams(
  modelParams?: Record<string, unknown>,
  originParams?: Record<string, unknown>,
): Record<string, unknown> {
  if (!modelParams) return {}
  const result: Record<string, unknown> = {}
  for (const [key, rawValue] of Object.entries(modelParams)) {
    const value = normalizeValue(key, rawValue)
    if (validationRules[key]) {
      if (validationRules[key](value)) {
        result[key] = value
      } else if (originParams && key in originParams) {
        result[key] = originParams[key]
      }
    } else if (MODEL_LOAD_ALLOW.has(key)) {
      result[key] = value
    }
  }
  return result
}
