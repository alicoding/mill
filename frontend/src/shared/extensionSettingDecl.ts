// ExtensionSettingDecl -- one declared user setting an extension
// offers (goal 0258), discriminated on `type` across the four-type
// floor every declarative settings platform shares: boolean, string,
// number, enum. The extension declares; the host renders the control
// (views/ExtensionSettingControl.tsx), stores the value centrally, and
// serves it back through one resolver
// (shared/extensionSettingsStore.ts) -- never per-extension UI. `key`
// is the stable persistence key under the extension's id;
// `defaultValue` is the behavior with nothing stored -- the store never
// learns defaults, so changing a default in a later release affects
// only users who never touched the control, exactly the converged
// settings semantic. A runtime plugin declares the same shape in its
// manifest (`contributes.settings`, plugins/pluginSettings.ts maps it
// here).
interface ExtensionSettingDeclBase {
  key: string
  label: string
  description: string
}
export type ExtensionSettingDecl =
  | (ExtensionSettingDeclBase & { type: 'boolean'; defaultValue: boolean })
  | (ExtensionSettingDeclBase & { type: 'string'; defaultValue: string; placeholder?: string })
  | (ExtensionSettingDeclBase & { type: 'number'; defaultValue: number; min?: number; max?: number; step?: number })
  | (ExtensionSettingDeclBase & { type: 'enum'; defaultValue: string; options: readonly { value: string; label: string }[] })
  // A vault reference (ADR-0048): the stored value is the entry's id
  // ('' = nothing picked); the host renders a picker over the vault's
  // titles and the plugin only ever reads the title back.
  | (ExtensionSettingDeclBase & { type: 'secretRef'; defaultValue: '' })

// ExtensionSettingValue -- what a stored or resolved setting can be.
export type ExtensionSettingValue = boolean | string | number
