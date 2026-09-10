import { useSyncExternalStore } from 'react'

// The removal signal (goal 0321): a removed plugin's folder is gone
// from disk, so every surface listing installed plugins must re-scan.
// Same change-counter shape the reload signal uses -- the value is
// meaningless, the change is the message.
let version = 0
const listeners = new Set<() => void>()
const lifecycleListeners = new Set<(pluginId: string) => void>()

export function notifyPluginRemoved(pluginId?: string): void {
  version++
  for (const listener of listeners) listener()
  if (pluginId) for (const listener of lifecycleListeners) listener(pluginId)
}

export function onPluginRemoved(listener: (pluginId: string) => void): () => void {
  lifecycleListeners.add(listener)
  return () => { lifecycleListeners.delete(listener) }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

function snapshot(): number {
  return version
}

export function usePluginRemoveVersion(): number {
  return useSyncExternalStore(subscribe, snapshot, snapshot)
}
