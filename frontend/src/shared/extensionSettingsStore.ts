import { create } from 'zustand'
import type { ExtensionSettingDecl, ExtensionSettingValue } from './extensionSettingDecl'
import { SettingsService } from './bindings'
import { background } from './background'

// Per-extension declared-setting VALUES (goal 0258) -- the stored
// overrides only; defaults live on each extension's own declaration
// (atlas/atlasNounRegistry.ts's ExtensionSettingDecl), so an
// extension absent here simply reads its declared default. Own store
// file, not more fields on store.ts, for the same synchronous
// non-React access reason extensionEnablementStore.ts documents: a
// canvas surface (the note editor's feature set) reads this at mount
// time outside React's render cycle.
//
// Wire contract: each value crosses the Wails boundary as its JSON
// literal in a string (settingsservice_extensionsettings.go's own
// header) -- decoded here once into typed scalars, encoded once in
// persistExtensionSetting.
interface ExtensionSettingsState {
  values: Record<string, Record<string, ExtensionSettingValue>>
  setValues: (values: Record<string, Record<string, ExtensionSettingValue>>) => void
}

export const useExtensionSettingsStore = create<ExtensionSettingsState>()((set) => ({
  values: {},
  setValues: (values) => set({ values }),
}))

// extensionSetting -- the one read every consumer uses: the stored
// value when the user has ever touched the control, else the
// declaration's own default. Fails closed to the default on a type
// mismatch (a stale blob, a declaration whose type changed between
// releases): a consumer expecting a number never receives a string.
export function extensionSetting<T extends ExtensionSettingValue>(extensionId: string, key: string, defaultValue: T): T {
  const stored = useExtensionSettingsStore.getState().values[extensionId]?.[key]
  if (stored === undefined || typeof stored !== typeof defaultValue) return defaultValue
  return stored as T
}

// resolveExtensionSetting -- extensionSetting against a full
// declaration: the same typed read, plus the checks only the
// declaration can state (an enum value no longer among the options, a
// non-finite number) -- each fails closed to the declared default.
export function resolveExtensionSetting(extensionId: string, decl: ExtensionSettingDecl): ExtensionSettingValue {
  const value = extensionSetting(extensionId, decl.key, decl.defaultValue)
  if (decl.type === 'enum' && !decl.options.some((o) => o.value === value)) return decl.defaultValue
  if (decl.type === 'number' && !Number.isFinite(value)) return decl.defaultValue
  return value
}

// setExtensionSettingLocal -- the OPTIMISTIC half of a write (goal
// 0258): the control changes instantly in the store, then the caller
// persists through SettingsService and refreshes -- a settings control
// that visibly lags its own round-trip reads as broken. The follow-up
// refresh reconciles if the write failed.
export function setExtensionSettingLocal(extensionId: string, key: string, value: ExtensionSettingValue): void {
  const state = useExtensionSettingsStore.getState()
  state.setValues({
    ...state.values,
    [extensionId]: { ...state.values[extensionId], [key]: value },
  })
}

// persistExtensionSetting -- the one write path every control uses:
// optimistic local set, then the central blob, then the refresh that
// reconciles either way (a failed write reverts to the stored truth).
export function persistExtensionSetting(extensionId: string, key: string, value: ExtensionSettingValue): Promise<void> {
  setExtensionSettingLocal(extensionId, key, value)
  return SettingsService.SetExtensionSetting(extensionId, key, JSON.stringify(value))
    .then(refreshExtensionSettings)
    .catch((err) => {
      console.error(err)
      return refreshExtensionSettings()
    })
}

// subscribeExtensionSetting -- fires fn with the new resolved value
// whenever THIS extension's THIS key changes in the store (a plugin's
// api.settings.onChange door, plugins/hostApi.ts). Returns the
// unsubscribe function.
export function subscribeExtensionSetting(extensionId: string, decl: ExtensionSettingDecl, fn: (value: ExtensionSettingValue) => void): () => void {
  let last = resolveExtensionSetting(extensionId, decl)
  return useExtensionSettingsStore.subscribe(() => {
    const next = resolveExtensionSetting(extensionId, decl)
    if (next === last) return
    last = next
    fn(next)
  })
}

function decodeLiteral(literal: string): ExtensionSettingValue | undefined {
  try {
    const v: unknown = JSON.parse(literal)
    return typeof v === 'boolean' || typeof v === 'string' || typeof v === 'number' ? v : undefined
  } catch {
    return undefined
  }
}

// Mirrors refreshDisabledExtensions' shape: the one refetch path,
// callable from App's boot effect, the mill-data-changed router, the
// plugin loader (before activation), and every control's own write.
export function refreshExtensionSettings(): Promise<void> {
  return background(SettingsService.GetExtensionSettings()
    .then((values) => {
      // The generated binding types every nested map value as
      // possibly-absent; normalize to the store's dense, decoded shape.
      const dense: Record<string, Record<string, ExtensionSettingValue>> = {}
      for (const [ext, keys] of Object.entries(values ?? {})) {
        if (!keys) continue
        dense[ext] = {}
        for (const [k, literal] of Object.entries(keys)) {
          const v = literal === undefined ? undefined : decodeLiteral(literal)
          if (v !== undefined) dense[ext][k] = v
        }
      }
      useExtensionSettingsStore.getState().setValues(dense)
    }), 'extensionSettings.getExtensionSettings')
}
