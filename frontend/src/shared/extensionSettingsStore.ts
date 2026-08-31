import { create } from 'zustand'
import { SettingsService } from './bindings'

// Per-extension declared-setting VALUES (goal 0258) -- the stored
// overrides only; defaults live on each extension's own declaration
// (atlas/atlasNounRegistry.ts's ExtensionSettingDecl), so an
// extension absent here simply reads its declared default. Own store
// file, not more fields on store.ts, for the same synchronous
// non-React access reason extensionEnablementStore.ts documents: a
// canvas surface (the note editor's feature set) reads this at mount
// time outside React's render cycle.
interface ExtensionSettingsState {
  values: Record<string, Record<string, boolean>>
  setValues: (values: Record<string, Record<string, boolean>>) => void
}

export const useExtensionSettingsStore = create<ExtensionSettingsState>()((set) => ({
  values: {},
  setValues: (values) => set({ values }),
}))

// extensionSetting -- the one read every consumer uses: the stored
// value when the user has ever touched the toggle, else the
// declaration's own default.
export function extensionSetting(extensionId: string, key: string, defaultValue: boolean): boolean {
  const stored = useExtensionSettingsStore.getState().values[extensionId]?.[key]
  return stored === undefined ? defaultValue : stored
}

// setExtensionSettingLocal -- the OPTIMISTIC half of a toggle write
// (goal 0258): the control flips instantly in the store, then the
// caller persists through SettingsService and refreshes -- a settings
// checkbox that visibly lags its own click round-trip reads as broken.
// The follow-up refresh reconciles if the write failed.
export function setExtensionSettingLocal(extensionId: string, key: string, value: boolean): void {
  const state = useExtensionSettingsStore.getState()
  state.setValues({
    ...state.values,
    [extensionId]: { ...state.values[extensionId], [key]: value },
  })
}

// Mirrors refreshDisabledExtensions' shape: the one refetch path,
// callable from App's boot effect, the mill-data-changed router, and
// the Extensions section's own toggle handler.
export function refreshExtensionSettings(): Promise<void> {
  return SettingsService.GetExtensionSettings()
    .then((values) => {
      // The generated binding types every nested map value as
      // possibly-absent; normalize to the store's dense shape.
      const dense: Record<string, Record<string, boolean>> = {}
      for (const [ext, keys] of Object.entries(values ?? {})) {
        if (!keys) continue
        dense[ext] = {}
        for (const [k, v] of Object.entries(keys)) {
          if (v !== undefined) dense[ext][k] = v
        }
      }
      useExtensionSettingsStore.getState().setValues(dense)
    })
    .catch(console.error)
}
