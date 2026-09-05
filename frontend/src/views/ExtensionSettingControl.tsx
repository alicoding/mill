import { useEffect, useState } from 'react'
import { copy } from '../shared/copy'
import { Checkbox, FormControl, Select, TextInput } from '@primer/react'
import type { ExtensionSettingDecl } from '../atlas/atlasNounRegistry'
import { persistExtensionSetting, resolveExtensionSetting, useExtensionSettingsStore } from '../shared/extensionSettingsStore'
import { SecretRefPicker } from '../shared/SecretPicker'

// ExtensionSettingControl -- ONE declared setting rendered generically
// (goal 0258), shared by the built-in noun row (ExtensionRow.tsx) and
// the installed-plugin row (ExtensionsInstalledPlugins.tsx): the
// extension declares {type, key, label, description, defaultValue};
// this host control reads the stored value (falling back to the
// declared default), writes through the central SettingsService blob,
// and refreshes the shared store so every consumer -- a canvas surface
// reading the setting at its next mount, a plugin's onChange -- sees
// the same truth. Subscribing to the store (not just reading it) keeps
// two open Settings views in agreement live, the same dataevent-driven
// convergence the enable toggle has.
//
// Commit semantics per type: boolean and enum persist on change (one
// gesture, one value); string and number commit on blur/Enter, since a
// per-keystroke persist re-renders every consumer mid-word, and Escape
// reverts the draft. An invalid number draft (not a number) reverts;
// one outside a declared min/max clamps.
export function ExtensionSettingControl({ extensionId, setting }: {
  extensionId: string
  setting: ExtensionSettingDecl
}) {
  useExtensionSettingsStore((s) => s.values)
  const value = resolveExtensionSetting(extensionId, setting)
  const persist = (next: typeof value) => { void persistExtensionSetting(extensionId, setting.key, next) }
  return (
    // Plain wrapper for the testid: FormControl's prop set is closed
    // (no HTML-attribute forwarding), so the hook lives one element up.
    <div data-testid={`extension-setting-${extensionId}-${setting.key}`} data-setting-type={setting.type}>
      <FormControl>
        {setting.type === 'boolean' && (
          <Checkbox checked={value === true} onChange={(e) => persist(e.target.checked)} />
        )}
        {setting.type === 'secretRef' && (
          <SecretRefPicker value={String(value)} onChange={persist} />
        )}
        {setting.type === 'enum' && (
          <Select value={String(value)} onChange={(e) => persist(e.target.value)}>
            {setting.options.map((o) => <Select.Option key={o.value} value={o.value}>{o.label}</Select.Option>)}
          </Select>
        )}
        {setting.type === 'string' && (
          <DraftInput value={String(value)} placeholder={setting.placeholder} onCommit={persist} />
        )}
        {setting.type === 'number' && (
          <DraftInput
            value={String(value)}
            type="number"
            min={setting.min}
            max={setting.max}
            step={setting.step}
            onCommit={(draft) => {
              const n = Number(draft)
              if (draft.trim() === '' || !Number.isFinite(n)) return false
              const lo = setting.min ?? -Infinity
              const hi = setting.max ?? Infinity
              persist(Math.min(hi, Math.max(lo, n)))
              return true
            }}
          />
        )}
        <FormControl.Label>{copy(setting.label)}</FormControl.Label>
        <FormControl.Caption>{copy(setting.description)}</FormControl.Caption>
      </FormControl>
    </div>
  )
}

// DraftInput -- a text field whose committed value lives in the store
// and whose in-progress text lives here: blur/Enter commit, Escape
// reverts, and a store change from elsewhere (another Settings view,
// a reconciling refresh) replaces an untouched draft. onCommit may
// return false to say the draft was invalid, which reverts it.
function DraftInput({ value, type, min, max, step, placeholder, onCommit }: {
  value: string
  type?: 'number'
  min?: number
  max?: number
  step?: number
  placeholder?: string
  onCommit: (draft: string) => boolean | void
}) {
  const [draft, setDraft] = useState(value)
  useEffect(() => { setDraft(value) }, [value])
  const commit = () => {
    if (draft === value) return
    if (onCommit(draft) === false) setDraft(value)
  }
  return (
    <TextInput
      size="small"
      type={type}
      min={min}
      max={max}
      step={step}
      placeholder={placeholder}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { e.preventDefault(); commit() }
        if (e.key === 'Escape') { e.preventDefault(); setDraft(value) }
      }}
    />
  )
}
