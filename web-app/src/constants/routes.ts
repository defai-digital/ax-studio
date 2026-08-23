export const route = {
  // home as new chat or thread
  home: '/',
  settings: {
    index: '/settings',
    model_providers: '/settings/providers/',
    providers: '/settings/providers/$providerName',
    general: '/settings/general',
    axEngine: '/settings/ax-engine',
  },
  hub: {
    index: '/hub/',
    model: '/hub/$modelId',
  },
  threadsDetail: '/threads/$threadId',
} as const
