// Type shims for the statically bundled extension sources (Electron build).
//
// vite resolves the real TypeScript sources via the aliases in
// web-app/vite.config.ts and transpiles them without type-checking. tsc uses
// these ambient declarations instead: the extension sources are written
// against their own toolchains (rolldown `define` constants, per-package
// tsconfigs with different lib/strictness) and are deliberately not part of
// this program. Keep these signatures in sync with the extension classes.

type ExtensionConstructorArgs = [
  url: string,
  name: string,
  productName?: string,
  active?: boolean,
  description?: string,
  version?: string,
]

declare module '@ax-studio/llamacpp-extension' {
  const AxStudioLlamacppExtension: new (
    ...args: ExtensionConstructorArgs
  ) => import('@ax-studio/core').AIEngine
  export default AxStudioLlamacppExtension
}

declare module '@ax-studio/download-extension' {
  const AxStudioDownloadManager: new (
    ...args: ExtensionConstructorArgs
  ) => import('@ax-studio/core').BaseExtension
  export default AxStudioDownloadManager
}

declare module '@ax-studio/conversational-extension' {
  const AxStudioConversationalExtension: new (
    ...args: ExtensionConstructorArgs
  ) => import('@ax-studio/core').ConversationalExtension
  export default AxStudioConversationalExtension
}
