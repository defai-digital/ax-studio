export const ANTHROPIC_VERSION_HEADER = 'anthropic-version'
export const ANTHROPIC_VERSION_VALUE = '2023-06-01'
export const ANTHROPIC_BROWSER_ACCESS_HEADER = 'anthropic-dangerous-direct-browser-access'
export const ANTHROPIC_BROWSER_ACCESS_VALUE = 'true'

// 'mlx' is intentionally NOT here: the mlx provider is a regular remote HTTP
// endpoint (ax-engine-server delegating to mlx_lm). Treating it as local would
// route loads through the llamacpp extension's engine manager, which has no
// 'mlx' engine registered, and fail with "Local engine 'mlx' is not available".
export const LOCAL_PROVIDER_IDS = new Set(['llamacpp', 'ollama'])

/** Default custom headers required for direct Anthropic API access from a browser. */
export const ANTHROPIC_DEFAULT_HEADERS = [
  { header: ANTHROPIC_VERSION_HEADER, value: ANTHROPIC_VERSION_VALUE },
  { header: ANTHROPIC_BROWSER_ACCESS_HEADER, value: ANTHROPIC_BROWSER_ACCESS_VALUE },
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
    custom_header: [...ANTHROPIC_DEFAULT_HEADERS]
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
  // ── MLX (via ax-engine-sdk → ax-engine-server → mlx_lm) ──────────────────
  // Local OpenAI-compatible endpoint that runs Apple MLX models from the HF
  // cache. Defaults match the launcher at
  //   ~/Library/Application Support/Ax-Studio/data/ax-mlx-launch.sh
  // Start that launcher (and the mlx_lm.server backend it spawns) before
  // sending a chat. To switch which model is loaded, rerun the launcher with
  // `MLX_MODEL=mlx-community/<name>`; mlx_lm.server loads one model per
  // process.
  {
    active: true,
    api_key: 'sk-local-mlx',
    base_url: 'http://127.0.0.1:19997/v1',
    explore_models_url: 'https://huggingface.co/mlx-community',
    provider: 'mlx',
    settings: [
      {
        key: 'base-url',
        title: 'Base URL',
        description:
          'ax-engine-server OpenAI endpoint. Started by `ax-mlx-launch.sh`; delegates to mlx_lm.server which reads MLX safetensors from the HF cache.',
        controller_type: 'input',
        controller_props: {
          placeholder: 'http://127.0.0.1:19997/v1',
          value: 'http://127.0.0.1:19997/v1',
        },
      },
      {
        key: 'api-key',
        title: 'API Key',
        description:
          'Local server; any non-empty value works. Stored only on this machine.',
        controller_type: 'input',
        controller_props: {
          placeholder: 'sk-local-mlx',
          value: 'sk-local-mlx',
          type: 'password',
          input_actions: ['unobscure', 'copy'],
        },
      },
    ],
    models: [
      {
        id: 'mlx-community/Qwen3.5-9B-MLX-4bit',
        name: 'Qwen3.5-9B MLX 4-bit',
        version: '1.0',
        description: 'Apple MLX 4-bit Qwen3.5-9B (in HF cache).',
        capabilities: ['completion', 'tools'],
      },
      {
        id: 'mlx-community/GLM-4.7-Flash-4bit',
        name: 'GLM-4.7-Flash MLX 4-bit',
        version: '1.0',
        description: 'Apple MLX 4-bit GLM-4.7-Flash MoE (in HF cache).',
        capabilities: ['completion', 'tools'],
      },
      {
        id: 'mlx-community/Qwen3.5-35B-A3B-4bit',
        name: 'Qwen3.5-35B-A3B MLX 4-bit',
        version: '1.0',
        description: 'Apple MLX 4-bit Qwen3.5-35B-A3B (in HF cache).',
        capabilities: ['completion', 'tools'],
      },
      {
        id: 'mlx-community/Qwen3.6-35B-A3B-4bit',
        name: 'Qwen3.6-35B-A3B MLX 4-bit',
        version: '1.0',
        description: 'Apple MLX 4-bit Qwen3.6-35B-A3B (in HF cache).',
        capabilities: ['completion', 'tools'],
      },
      {
        id: 'mlx-community/Qwen3.6-35B-A3B-5bit',
        name: 'Qwen3.6-35B-A3B MLX 5-bit',
        version: '1.0',
        description: 'Apple MLX 5-bit Qwen3.6-35B-A3B (in HF cache).',
        capabilities: ['completion', 'tools'],
      },
    ],
  },
]
