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
  // ── MLX (in-process via ax-engine-sdk → ax-engine-mlx native runner) ────
  // Chat requests route through a Tauri IPC fetch shim
  // (web-app/src/lib/mlx-ipc-fetch.ts) → Rust commands `mlx_chat_stream` /
  // `mlx_chat_completion` → ax-engine-sdk in `mlx_only` mode → ax-engine-mlx
  // Rust runner → mlx-c 0.6.0 → Apple MLX (Metal). No Python subprocess.
  //
  // **n-gram acceleration**: ON by default. Disable for A/B testing by
  // launching with `AX_MLX_DISABLE_NGRAM=1 make dev`. Compare t/s in the UI
  // — the worker logs `ngram=ON` or `ngram=OFF (direct path)` at session
  // build time so you can confirm which mode is active.
  //
  // **Stability today** (this is the path with the upstream slice bug —
  // mlx-c 0.6.0 aborts the entire app on certain 4-bit kernels):
  //   ✅ Qwen3-4B-4bit, Qwen3-8B-4bit  — plain `qwen3` dense, different
  //      decode kernel than the buggy `qwen3_5` family. Recommended for
  //      n-gram testing.
  //   ⚠️  Qwen3.6-35B-A3B-5bit          — higher quant avoids the worst
  //      slice bug but had unspecified issues last run.
  //   ❌ Qwen3.5-9B-MLX-4bit            — dense-hybrid 4-bit, aborts app
  //      (ax-engine#23).
  //   ❌ GLM-4.7-Flash-4bit, Qwen3.6-35B-A3B-4bit — same #23 bug, MoE.
  //   ❌ Qwen3.5-35B-A3B-4bit           — runs but empty/`|`-only output.
  //
  // base_url is the historical ax-engine-server endpoint — kept so existing
  // saved settings don't break; the IPC fetch shim ignores it.
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
    // All AX-supported MLX models on disk are exposed. Native mode runs
    // n-gram-disabled by default (n-gram code path triggers the upstream
    // 4-bit slice abort — see worker.rs `build_session`). Labels reflect
    // live test results:
    //   ✅ confirmed working
    //   ⚠️  works but slow / degraded
    //   ❌ produces near-empty output (upstream MoE-4-bit defect)
    models: [
      {
        id: 'mlx-community/Qwen3-4B-4bit',
        name: 'Qwen3-4B MLX 4-bit (2.1 GB · ✅ fastest)',
        version: '1.0',
        description:
          'Apple MLX 4-bit Qwen3-4B dense. Smallest local model, fastest cold-start (~5s). Best default for short chats and code completion.',
        capabilities: ['completion', 'tools'],
      },
      {
        id: 'mlx-community/Qwen3-8B-4bit',
        name: 'Qwen3-8B MLX 4-bit (4.3 GB · ✅ balanced)',
        version: '1.0',
        description:
          'Apple MLX 4-bit Qwen3-8B dense. Same plain-`qwen3` architecture as the 4B — works in native mode without crashes.',
        capabilities: ['completion', 'tools'],
      },
      {
        id: 'mlx-community/Qwen3.5-9B-MLX-4bit',
        name: 'Qwen3.5-9B MLX 4-bit (5.6 GB · ✅ tested, ~6.5 t/s)',
        version: '1.0',
        description:
          'Apple MLX 4-bit Qwen3.5-9B dense + hybrid attention. Confirmed working in native mode with n-gram OFF (the n-gram path is what triggered the historical slice abort).',
        capabilities: ['completion', 'tools'],
      },
      {
        id: 'mlx-community/gemma-4-e2b-it-4bit',
        name: 'Gemma 4 E2B MLX 4-bit (3.6 GB · new, untested)',
        version: '1.0',
        description:
          'Apple MLX 4-bit Gemma 4 E2B (effective 2B). Hand-written ax-engine-mlx forward pass exists; first chat will be the smoke test. Manifest generated locally via `generate-manifest`.',
        capabilities: ['completion', 'tools'],
      },
      {
        id: 'mlx-community/gemma-4-e4b-it-4bit',
        name: 'Gemma 4 E4B MLX 4-bit (5.3 GB · new, untested)',
        version: '1.0',
        description:
          'Apple MLX 4-bit Gemma 4 E4B (effective 4B). Same family as E2B above.',
        capabilities: ['completion', 'tools'],
      },
      {
        id: 'mlx-community/gemma-4-31b-it-4bit',
        name: 'Gemma 4 31B MLX 4-bit (18 GB · new, untested)',
        version: '1.0',
        description:
          'Apple MLX 4-bit Gemma 4 31B dense. Larger model — slower load + generation but higher quality.',
        capabilities: ['completion', 'tools'],
      },
      {
        id: 'mlx-community/Qwen3-Coder-Next-4bit',
        name: 'Qwen3 Coder Next MLX 4-bit (42 GB · new, untested)',
        version: '1.0',
        description:
          'Apple MLX 4-bit Qwen3-Coder-Next (`qwen3_next` MoE — GatedDelta linear attention + sparse top-k MoE). Per the AX README this architecture sees the largest n-gram speedup on coding workloads; with n-gram disabled, plain decode applies.',
        capabilities: ['completion', 'tools'],
      },
      {
        id: 'mlx-community/Qwen3.6-35B-A3B-5bit',
        name: 'Qwen3.6-35B-A3B MLX 5-bit (23 GB · ⚠️ untested)',
        version: '1.0',
        description:
          'Apple MLX 5-bit Qwen3.6-35B-A3B MoE. Had unspecified issues in earlier sessions; try last and only with short prompts.',
        capabilities: ['completion', 'tools'],
      },
      {
        id: 'mlx-community/Qwen3.6-35B-A3B-4bit',
        name: 'Qwen3.6-35B-A3B MLX 4-bit (19 GB · ❌ near-empty output)',
        version: '1.0',
        description:
          'Apple MLX 4-bit Qwen3.6-35B-A3B MoE. Native mode generates only 3 tokens and stops — upstream MoE-4-bit decode defect, separate from the n-gram bug.',
        capabilities: ['completion', 'tools'],
      },
      {
        id: 'mlx-community/Qwen3.5-35B-A3B-4bit',
        name: 'Qwen3.5-35B-A3B MLX 4-bit (19 GB · ❌ degraded output)',
        version: '1.0',
        description:
          'Apple MLX 4-bit Qwen3.5-35B-A3B MoE. Same MoE-4-bit defect as Qwen3.6-35B-A3B-4bit above — produces empty / `|`-only responses.',
        capabilities: ['completion', 'tools'],
      },
      {
        id: 'mlx-community/GLM-4.7-Flash-4bit',
        name: 'GLM-4.7-Flash MLX 4-bit (16 GB · ❌ near-empty output)',
        version: '1.0',
        description:
          'Apple MLX 4-bit GLM-4.7-Flash MoE. Same MoE-4-bit upstream defect — only ~9 tokens generated before stopping.',
        capabilities: ['completion', 'tools'],
      },
    ],
  },
]
