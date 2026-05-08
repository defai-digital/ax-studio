import { APIs } from '@/lib/service'
import { EventEmitter } from '@/services/events/EventEmitter'

type CoreBridgeOptions = {
  withApi?: boolean
  withEvents?: boolean
}

export function ensureCoreBridge(options: CoreBridgeOptions = {}): NonNullable<Window['core']> {
  const core = (window.core ||= {} as NonNullable<Window['core']>)

  if (options.withApi && !core.api) {
    core.api = APIs
  }

  if (options.withEvents && !core.events) {
    core.events = new EventEmitter()
  }

  return core
}
