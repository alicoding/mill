import type { ExtensionSettingDecl } from '../atlas/atlasNounRegistry'
import type { Manifest, SettingContribution } from '../../bindings/github.com/alicoding/mill/internal/services/pluginsvc/models'
import { resolveExtensionSetting } from '../shared/extensionSettingsStore'
import { secretTitleOf } from '../shared/secretTitleCache'

// snapshotPluginSettings resolves every declared setting's CURRENT
// value once, the same read buildPluginAPI's settings.get performs
// (a secretRef answers its vault entry's title, never its value) --
// an activation frame's own settings.get stays synchronous over this
// snapshot rather than a round trip (docs/goals/0375 S1b).
export function snapshotPluginSettings(manifest: Manifest): Record<string, boolean | string | number> {
  const pluginId = manifest.id
  const snapshot: Record<string, boolean | string | number> = {}
  for (const decl of settingDeclsFromManifest(manifest)) {
    const value = resolveExtensionSetting(pluginId, decl)
    snapshot[decl.key] = decl.type === 'secretRef' ? secretTitleOf(String(value)) : value
  }
  return snapshot
}

// settingDeclsFromManifest -- a plugin's manifest `contributes.settings`
// (docs/goals/0258 slice 1, VS Code's `default` spelling) restated as
// the same ExtensionSettingDecl every compiled-in noun declares, so ONE
// host control renders both and ONE resolver serves both. The manifest
// was already validated fail-closed by pluginsvc (type, default-of-
// type, enum options, min/max) before it reached the frontend, so a
// declaration here is trusted; the switch below is exhaustive over the
// validated type set and the shape narrowing is the only work left.
export function settingDeclsFromManifest(manifest: Manifest): ExtensionSettingDecl[] {
  return (manifest.contributes?.settings ?? []).map(settingDeclFromContribution)
}

function settingDeclFromContribution(c: SettingContribution): ExtensionSettingDecl {
  const base = { key: c.key, label: c.label, description: c.description ?? '' }
  switch (c.type) {
    case 'boolean':
      return { ...base, type: 'boolean', defaultValue: Boolean(c.default) }
    case 'number':
      return { ...base, type: 'number', defaultValue: Number(c.default), min: c.min ?? undefined, max: c.max ?? undefined }
    case 'secretRef':
      return { ...base, type: 'secretRef', defaultValue: '' }
    case 'enum':
      return {
        ...base,
        type: 'enum',
        defaultValue: String(c.default),
        options: (c.options ?? []).map((o) => ({ value: o.value, label: o.label })),
      }
    default:
      return { ...base, type: 'string', defaultValue: String(c.default ?? '') }
  }
}
