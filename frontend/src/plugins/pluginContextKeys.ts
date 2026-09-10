import { create } from 'zustand'
import type { WhenFacts, WhenValue } from './whenClause'

// The host-held table api.context.set(key, value) writes into (goal
// 0349 S2c Decision 1): the extension-host "setContext" pattern,
// adapted for a sandboxed frame -- a framed plugin cannot answer a
// `when` clause itself, synchronously, so it contributes a FACT
// instead, which the host evaluates on its own behalf.
//
// A Zustand store, not a plain Map: pluginMenuFacts.ts's own consumers
// read it once per menu build, but WorkTabShell's view/title seat
// renders continuously and must re-render when a plugin's own key
// changes -- the same cross-context reactive shape shared/uiSignalStore.ts's
// own header already established.

interface PluginContextKeyState {
  byPlugin: Record<string, Record<string, WhenValue>>
  setKey: (pluginId: string, key: string, value: WhenValue) => void
}

export const usePluginContextKeyStore = create<PluginContextKeyState>()((set) => ({
  byPlugin: {},
  setKey: (pluginId, key, value) => set((s) => ({
    byPlugin: { ...s.byPlugin, [pluginId]: { ...s.byPlugin[pluginId], [key]: value } },
  })),
}))

function isWhenValue(value: unknown): value is WhenValue {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return true
  return Array.isArray(value) && value.every((v) => typeof v === 'string')
}

// setPluginContextKey is api.context.set's own host-side body (called
// directly for a same-DOM plugin, routed through the activation
// bridge's 'context.set' door for a framed one): a plugin may only
// write its OWN namespace, so a key already carrying the merged fact
// prefix ("plugin.") is refused rather than silently double-prefixed
// into something that reads as another plugin's own key.
export function setPluginContextKey(pluginId: string, key: string, value: unknown): void {
  if (key.trim() === '') throw new Error(`plugin ${pluginId}: context.set needs a non-empty key`)
  if (key.split('.')[0] === 'plugin') {
    throw new Error(`plugin ${pluginId}: context key "${key}" must not start with "plugin.". That prefix is added automatically wherever a when clause reads it back`)
  }
  if (!isWhenValue(value)) {
    throw new Error(`plugin ${pluginId}: context value for "${key}" must be a string, number, boolean, or an array of strings`)
  }
  usePluginContextKeyStore.getState().setKey(pluginId, key, value)
}

// pluginContextFacts answers one plugin's own keys, namespaced
// "plugin.<key>" (goal 0349 S2c Decision 2) -- the shape every when
// clause addresses them by, whichever seat is evaluating.
export function pluginContextFacts(pluginId: string): WhenFacts {
  const own = usePluginContextKeyStore.getState().byPlugin[pluginId]
  if (!own) return {}
  const out: Record<string, WhenValue> = {}
  for (const [key, value] of Object.entries(own)) out[`plugin.${key}`] = value
  return out
}

// mergePluginContext is the one merge rule every seat's own fact
// builder applies (Decision 2): the calling plugin's own keys, with
// the seat's host-computed facts spread LAST so a same-named host fact
// always wins -- a plugin can shadow nothing Mill itself already
// answers.
export function mergePluginContext(hostFacts: WhenFacts, pluginId: string): WhenFacts {
  return { ...pluginContextFacts(pluginId), ...hostFacts }
}
