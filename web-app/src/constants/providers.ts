const ANTHROPIC_VERSION_HEADER = 'anthropic-version'
const ANTHROPIC_VERSION_VALUE = '2023-06-01'
const ANTHROPIC_BROWSER_ACCESS_HEADER =
  'anthropic-dangerous-direct-browser-access'
const ANTHROPIC_BROWSER_ACCESS_VALUE = 'true'

/**
 * Product provider id for in-process AX Engine (Apple MLX via ax-engine-sdk).
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

/** True for the in-process AX Engine provider (including legacy `mlx` id). */
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
 * In-process AX Engine no longer uses a local HTTP engine (old :19997 port).
 * Chat goes through Tauri IPC (`mlx_chat_*`); this placeholder only satisfies
 * provider schema / OpenAI-compatible settings fields.
 *
 * Port `0` marks "no listening server". Do not point this at a real port.
 */
export const MLX_IN_PROCESS_BASE_URL = 'http://127.0.0.1:0/v1'
/** @deprecated Use MLX_IN_PROCESS_BASE_URL — same placeholder for AX Engine. */
export const AX_ENGINE_IN_PROCESS_BASE_URL = MLX_IN_PROCESS_BASE_URL

/** Pre-in-process defaults that must be rewritten on load. */
export const LEGACY_MLX_BASE_URLS = new Set([
  'http://127.0.0.1:19997/v1',
  'http://127.0.0.1:19997',
  'http://localhost:19997/v1',
  'http://localhost:19997',
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
  // AX Engine (AX Studio -> Tauri IPC -> ax-engine-sdk native runner -> Apple MLX)
  //
  // Default Local Engine backend is **in_process** (ADR-009). There is no
  // HTTP MLX server. Sidecar `ax-engine serve` is optional/future —
  // see web-app/src/lib/local-engine/.
  // Models are discovered from HF cache / app-managed imports. Do not add
  // catalog models here, otherwise the Hub will mark them as downloaded before
  // they exist on disk.
  {
    active: true,
    api_key: 'sk-local-ax-engine',
    base_url: MLX_IN_PROCESS_BASE_URL,
    explore_models_url: 'https://huggingface.co/mlx-community',
    provider: AX_ENGINE_PROVIDER_ID,
    settings: [
      {
        key: 'base-url',
        title: 'Base URL',
        description:
          'Not used for chat. AX Engine runs in-process via ax-engine-sdk (Tauri IPC). Port 0 means no local HTTP engine is listening.',
        controller_type: 'input',
        controller_props: {
          placeholder: MLX_IN_PROCESS_BASE_URL,
          value: MLX_IN_PROCESS_BASE_URL,
        },
      },
      {
        key: 'api-key',
        title: 'API Key',
        description:
          'Local in-process runner; any non-empty value works. Stored only on this machine.',
        controller_type: 'input',
        controller_props: {
          placeholder: 'sk-local-ax-engine',
          value: 'sk-local-ax-engine',
          type: 'password',
          input_actions: ['unobscure', 'copy'],
        },
      },
    ],
    models: [],
  },
]
