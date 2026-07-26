export const route = {
  // home as new chat or thread
  home: '/',
  axBi: '/ax-bi',
  settings: {
    index: '/settings',
    model_providers: '/settings/providers/',
    providers: '/settings/providers/$providerName',
    general: '/settings/general',
  },
  hub: {
    index: '/hub/',
    model: '/hub/$modelId',
  },
  threadsDetail: '/threads/$threadId',
} as const
