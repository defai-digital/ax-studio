export const route = {
  // home as new chat or thread
  home: '/',
  axBi: '/settings/ax-bi',
  legacyAxBi: '/ax-bi',
  settings: {
    index: '/settings',
    model_providers: '/settings/providers/',
    providers: '/settings/providers/$providerName',
    general: '/settings/general',
    axEngine: '/settings/ax-engine',
    axBi: '/settings/ax-bi',
  },
  hub: {
    index: '/hub/',
    model: '/hub/$modelId',
  },
  threadsDetail: '/threads/$threadId',
} as const
