import AxStudioLlamacppExtension from '@ax-studio/llamacpp-extension'
import AxStudioDownloadManager from '@ax-studio/download-extension'
import AxStudioConversationalExtension from '@ax-studio/conversational-extension'

import { ExtensionManager } from '@/lib/extension'

/**
 * Electron shell: static replacement for the dynamic extension system
 * (extensions.json + tgz activation via `get_active_extensions` /
 * `install_extensions`, which are intentionally unimplemented under Electron).
 *
 * The three built-in extensions are bundled at build time and registered into
 * the same structures the dynamic path uses:
 *   - ExtensionManager.register(name, instance) — same names the Tauri
 *     manifests carry (the package names), so `getByName()` callers and
 *     localStorage-keyed settings stay compatible.
 *   - ExtensionManager.load() → onLoad() — AIEngine.onLoad() registers the
 *     engine in EngineManager under its provider key ('llamacpp'), mirroring
 *     the dynamic activation flow.
 *
 * Settings persistence is unchanged: BaseExtension stores settings in
 * localStorage keyed by extension name.
 */
export async function registerStaticExtensions(): Promise<void> {
  const extensionManager = ExtensionManager.getInstance()

  extensionManager.register(
    '@ax-studio/conversational-extension',
    new AxStudioConversationalExtension(
      '',
      '@ax-studio/conversational-extension',
      'Conversational',
      true
    )
  )
  extensionManager.register(
    '@ax-studio/download-extension',
    new AxStudioDownloadManager(
      '',
      '@ax-studio/download-extension',
      'Download Manager',
      true
    )
  )
  extensionManager.register(
    '@ax-studio/llamacpp-extension',
    new AxStudioLlamacppExtension(
      '',
      '@ax-studio/llamacpp-extension',
      'llama.cpp Inference Engine',
      true
    )
  )

  await extensionManager.load()
}
