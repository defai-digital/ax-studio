const ANTHROPIC_VERSION_HEADER = 'anthropic-version'
const ANTHROPIC_VERSION_VALUE = '2023-06-01'
const ANTHROPIC_BROWSER_ACCESS_HEADER =
  'anthropic-dangerous-direct-browser-access'
const ANTHROPIC_BROWSER_ACCESS_VALUE = 'true'

/**
 * Product provider id for AX Engine (Apple MLX via managed/attached sidecar).
 * Formerly named `mlx` in settings/store — migrate with `normalizeProviderId`.
 */
export const AX_ENGINE_PROVIDER_ID = 'ax-engine'
/** Pre-rename product id still present in persisted stores / old builds. */
export const LEGACY_MLX_PROVIDER_ID = 'mlx'

export const LOCAL_PROVIDER_IDS = new Set([
  'llamacpp',
  'ollama',
  AX_ENGINE_PROVIDER_ID,
  // Keep legacy id so in-flight/persisted values still count as local.
  LEGACY_MLX_PROVIDER_ID,
])

/** True for the AX Engine provider (including legacy `mlx` id). */
export function isAxEngineProvider(providerId: string | undefined | null): boolean {
  return (
    providerId === AX_ENGINE_PROVIDER_ID || providerId === LEGACY_MLX_PROVIDER_ID
  )
}

/** Map legacy `mlx` product id → `ax-engine`. Leave other ids unchanged. */
export function normalizeProviderId(providerId: string): string {
  return providerId === LEGACY_MLX_PROVIDER_ID
    ? AX_ENGINE_PROVIDER_ID
    : providerId
}

/**
 * Historical placeholder for the retired in-process-only product story.
 * Port `0` means "no listening server". Electron chat does **not** use this —
 * ModelFactory resolves the live sidecar base URL from `ax_engine_status`
 * (default loopback 31418/v1). Kept for migration of old persisted settings.
 */
export const MLX_IN_PROCESS_BASE_URL = 'http://127.0.0.1:0/v1'
/** @deprecated Use MLX_IN_PROCESS_BASE_URL — same placeholder for AX Engine. */
export const AX_ENGINE_IN_PROCESS_BASE_URL = MLX_IN_PROCESS_BASE_URL

/**
 * Default OpenAI-compatible base for the managed `ax-engine serve` sidecar
 * (docs: ax-engine LOCAL-ENGINE-CLIENTS / SERVER). Live chat prefers the URL
 * reported by `ax_engine_status` when the server is ready.
 */
export const AX_ENGINE_SIDECAR_DEFAULT_BASE_URL = 'http://127.0.0.1:31418/v1'
/** Default Bearer key when `AX_ENGINE_API_KEY` is unset (sidecar manager). */
export const AX_ENGINE_SIDECAR_DEFAULT_API_KEY = 'local'

/** Pre-in-process defaults that must be rewritten on load. */
export const LEGACY_MLX_BASE_URLS = new Set([
  'http://127.0.0.1:19997/v1',
  'http://127.0.0.1:19997',
  'http://localhost:19997/v1',
  'http://localhost:19997',
  // Retired port-0 placeholder — rewrite to the sidecar default on load.
  MLX_IN_PROCESS_BASE_URL,
  'http://127.0.0.1:0',
  'http://localhost:0/v1',
  'http://localhost:0',
])

export const LEGACY_BUNDLED_MLX_MODEL_IDS = new Set([
  'mlx-community/Qwen3-4B-4bit',
  'mlx-community/Qwen3-8B-4bit',
  'mlx-community/Qwen3.5-9B-MLX-4bit',
  'mlx-community/Qwen3.6-27B-4bit',
  'mlx-community/gemma-4-e2b-it-4bit',
  'mlx-community/gemma-4-e4b-it-4bit',
  'mlx-community/gemma-4-12B-it-4bit',
  'mlx-community/gemma-4-31b-it-4bit',
  'mlx-community/Qwen3-Coder-Next-4bit',
  'mlx-community/Qwen3.6-35B-A3B-5bit',
  'mlx-community/Qwen3.6-35B-A3B-4bit',
  'mlx-community/GLM-4.7-Flash-4bit',
])

/** Default custom headers required for direct Anthropic API access from a browser. */
export const ANTHROPIC_DEFAULT_HEADERS = [
  { header: ANTHROPIC_VERSION_HEADER, value: ANTHROPIC_VERSION_VALUE },
  {
    header: ANTHROPIC_BROWSER_ACCESS_HEADER,
    value: ANTHROPIC_BROWSER_ACCESS_VALUE,
  },
] as const

export const openAIProviderSettings = [
  {
    key: 'api-key',
    title: 'API Key',
    description:
      "The OpenAI API uses API keys for authentication. Visit your [API Keys](https://platform.openai.com/account/api-keys) page to retrieve the API key you'll use in your requests.",
    controller_type: 'input',
    controller_props: {
      placeholder: 'Insert API Key',
      value: '',
      type: 'password',
      input_actions: ['unobscure', 'copy'],
    },
  },
  {
    key: 'base-url',
    title: 'Base URL',
    description:
      'The base endpoint to use. See the [OpenAI API documentation](https://platform.openai.com/docs/api-reference/chat/create) for more information.',
    controller_type: 'input',
    controller_props: {
      placeholder: 'https://api.openai.com/v1',
      value: 'https://api.openai.com/v1',
    },
  },
]
export const predefinedProviders = [
  {
    active: true,
    api_key: '',
    base_url: 'https://api.openai.com/v1',
    explore_models_url: 'https://platform.openai.com/docs/models',
    provider: 'openai',
    settings: openAIProviderSettings,
    models: [],
  },
  {
    active: true,
    api_key: '',
    base_url: 'https://YOUR-RESOURCE-NAME.openai.azure.com/openai/v1',
    explore_models_url: 'https://oai.azure.com/deployments',
    provider: 'azure',
    settings: [
      {
        key: 'api-key',
        title: 'API Key',
        description:
          'The Azure OpenAI API uses API keys for authentication. Visit your [Azure OpenAI Studio](https://oai.azure.com/) to retrieve the API key from your resource.',
        controller_type: 'input',
        controller_props: {
          placeholder: 'Insert API Key',
          value: '',
          type: 'password',
          input_actions: ['unobscure', 'copy'],
        },
      },
      {
        key: 'base-url',
        title: 'Base URL',
        description:
          'Your Azure OpenAI resource endpoint. See the [Azure OpenAI documentation](https://learn.microsoft.com/en-us/azure/ai-foundry/openai/latest) for more information.',
        controller_type: 'input',
        controller_props: {
          placeholder: 'https://YOUR-RESOURCE-NAME.openai.azure.com/openai/v1',
          value: 'https://YOUR-RESOURCE-NAME.openai.azure.com/openai/v1',
        },
      },
    ],
    models: [],
  },
  {
    active: true,
    api_key: '',
    base_url: 'https://api.anthropic.com/v1',
    provider: 'anthropic',
    explore_models_url:
      'https://docs.anthropic.com/en/docs/about-claude/models',
    settings: [
      {
        key: 'api-key',
        title: 'API Key',
        description:
          "The Anthropic API uses API keys for authentication. Visit your [API Keys](https://console.anthropic.com/settings/keys) page to retrieve the API key you'll use in your requests.",
        controller_type: 'input',
        controller_props: {
          placeholder: 'Insert API Key',
          value: '',
          type: 'password',
          input_actions: ['unobscure', 'copy'],
        },
      },
      {
        key: 'base-url',
        title: 'Base URL',
        description:
          'The base endpoint to use. See the [Anthropic API documentation](https://docs.anthropic.com/en/api/messages) for more information.',
        controller_type: 'input',
        controller_props: {
          placeholder: 'https://api.anthropic.com',
          value: 'https://api.anthropic.com',
        },
      },
    ],
    models: [],
    custom_header: [...ANTHROPIC_DEFAULT_HEADERS],
  },
  {
    active: true,
    api_key: '',
    base_url: 'https://openrouter.ai/api/v1',
    explore_models_url: 'https://openrouter.ai/models',
    provider: 'openrouter',
    settings: [
      {
        key: 'api-key',
        title: 'API Key',
        description:
          "The OpenRouter API uses API keys for authentication. Visit your [API Keys](https://openrouter.ai/settings/keys) page to retrieve the API key you'll use in your requests.",
        controller_type: 'input',
        controller_props: {
          placeholder: 'Insert API Key',
          value: '',
          type: 'password',
          input_actions: ['unobscure', 'copy'],
        },
      },
      {
        key: 'base-url',
        title: 'Base URL',
        description:
          'The base endpoint to use. See the [OpenRouter API documentation](https://openrouter.ai/docs/api-reference/overview) for more information.',
        controller_type: 'input',
        controller_props: {
          placeholder: 'https://openrouter.ai/api/v1',
          value: 'https://openrouter.ai/api/v1',
        },
      },
    ],
    models: [
      {
        id: 'deepseek/deepseek-r1:free',
        name: 'DeepSeek-R1 (free)',
        version: '1.0',
        description: '',
        capabilities: ['completion'],
      },
      {
        id: 'qwen/qwen3-30b-a3b:free',
        name: 'Qwen3 30B A3B (free)',
        version: '1.0',
        description: '',
        capabilities: ['completion'],
      },
    ],
  },
  {
    active: true,
    api_key: '',
    base_url: 'https://api.x.ai/v1',
    explore_models_url: 'https://docs.x.ai/docs/models',
    provider: 'xai',
    settings: [
      {
        key: 'api-key',
        title: 'API Key',
        description:
          "The xAI API uses API keys for authentication. Visit your [API Keys](https://console.x.ai/settings/keys) page to retrieve the API key you'll use in your requests.",
        controller_type: 'input',
        controller_props: {
          placeholder: 'Insert API Key',
          value: '',
          type: 'password',
          input_actions: ['unobscure', 'copy'],
        },
      },
      {
        key: 'base-url',
        title: 'Base URL',
        description:
          'The base endpoint to use. See the [xAI API documentation](https://docs.x.ai/api) for more information.',
        controller_type: 'input',
        controller_props: {
          placeholder: 'https://api.x.ai/v1',
          value: 'https://api.x.ai/v1',
        },
      },
    ],
    models: [
      {
        id: 'grok-4.3',
        name: 'Grok 4.3',
        version: '1.0',
        description: 'xAI Grok 4.3 model with tool calling support.',
        capabilities: ['completion', 'tools', 'vision'],
      },
      {
        id: 'grok-3',
        name: 'Grok 3',
        version: '1.0',
        description: 'xAI Grok 3 model with tool calling support.',
        capabilities: ['completion', 'tools', 'vision'],
      },
    ],
  },
  {
    active: true,
    api_key: '',
    base_url: 'https://api.groq.com/openai/v1',
    explore_models_url: 'https://console.groq.com/docs/models',
    provider: 'groq',
    settings: [
      {
        key: 'api-key',
        title: 'API Key',
        description:
          "The Groq API uses API keys for authentication. Visit your [API Keys](https://console.groq.com/keys) page to retrieve the API key you'll use in your requests.",
        controller_type: 'input',
        controller_props: {
          placeholder: 'Insert API Key',
          value: '',
          type: 'password',
          input_actions: ['unobscure', 'copy'],
        },
      },
      {
        key: 'base-url',
        title: 'Base URL',
        description:
          'The base OpenAI-compatible endpoint to use. See the [Groq documentation](https://console.groq.com/docs) for more information.',
        controller_type: 'input',
        controller_props: {
          placeholder: 'https://api.groq.com/openai/v1',
          value: 'https://api.groq.com/openai/v1',
        },
      },
    ],
    models: [],
  },
  {
    active: true,
    api_key: '',
    base_url: 'https://generativelanguage.googleapis.com/v1beta/openai',
    explore_models_url: 'https://ai.google.dev/gemini-api/docs/models/gemini',
    provider: 'gemini',
    settings: [
      {
        key: 'api-key',
        title: 'API Key',
        description:
          "The Google API uses API keys for authentication. Visit your [API Keys](https://aistudio.google.com/apikey) page to retrieve the API key you'll use in your requests.",
        controller_type: 'input',
        controller_props: {
          placeholder: 'Insert API Key',
          value: '',
          type: 'password',
          input_actions: ['unobscure', 'copy'],
        },
      },
      {
        key: 'base-url',
        title: 'Base URL',
        description:
          'The base OpenAI-compatible endpoint to use. See the [Gemini documentation](https://ai.google.dev/gemini-api/docs/openai) for more information.',
        controller_type: 'input',
        controller_props: {
          placeholder:
            'https://generativelanguage.googleapis.com/v1beta/openai',
          value: 'https://generativelanguage.googleapis.com/v1beta/openai',
        },
      },
    ],
    models: [],
  },
  // AX Engine — Electron manages `ax-engine serve` as a local OpenAI-compatible
  // sidecar (default http://127.0.0.1:31418/v1). Chat uses the live URL/key from
  // ax_engine_status when ready; these defaults match the managed server.
  // Models are discovered from HF cache / app-managed imports. Do not add
  // catalog models here, otherwise the Hub will mark them as downloaded before
  // they exist on disk.
  {
    active: true,
    connection_mode: 'managed',
    api_key: AX_ENGINE_SIDECAR_DEFAULT_API_KEY,
    base_url: AX_ENGINE_SIDECAR_DEFAULT_BASE_URL,
    explore_models_url: 'https://huggingface.co/mlx-community',
    provider: AX_ENGINE_PROVIDER_ID,
    // Connection mode, endpoint, and credentials live on the dedicated AX
    // Engine settings page. Managed mode deliberately exposes no URL/key fields.
    settings: [],
    models: [],
  },
]
