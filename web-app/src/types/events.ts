export enum SystemEvent {
  MCP_UPDATE = 'mcp-update',
  KILL_SIDECAR = 'kill-sidecar',
  MCP_ERROR = 'mcp-error',
  DEEP_LINK = 'deep-link',
  GLOBAL_WAKE = 'global-wake',
  DOCK_FILE_DROP = 'dock-file-drop',
  VOICE_LEVEL = 'voice-level',
  VOICE_STATE = 'voice-state',
  VOICE_TRANSCRIPT = 'voice-transcript',
}

/**
 * DOM CustomEvent dispatched on `window` after a global wake navigation so
 * the mounted composer focuses its textarea (ChatInput listens for it).
 */
export const COMPOSER_FOCUS_EVENT = 'ax-studio:focus-composer'
