// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExtensionSettingDecl } from '../atlas/atlasNounRegistry'
import { useExtensionSettingsStore } from '../shared/extensionSettingsStore'

// The entityRef control is a plugged-in surface (docs/goals/0400): the
// setting sheet renders the SAME picker a node ConfigField of that
// RefKind uses (configure/EntityRefField.tsx), never a second list UI
// of its own -- this proves the wiring (which component, which props),
// not EntityRefField's own picking/quick-create behavior (covered by
// its own suite and the runtime-plugin-live-view e2e).

type Props = Record<string, unknown> & { children?: React.ReactNode }
vi.mock('@primer/react', () => {
  const strip = (rest: Props) => {
    const attrs = { ...rest }
    delete attrs.leadingVisual
    return attrs
  }
  const Checkbox = (rest: Props) => <input type="checkbox" {...strip(rest)} />
  const TextInput = (rest: Props) => <input {...strip(rest)} />
  const SelectOption = ({ children, ...rest }: Props) => <option {...strip(rest)}>{children}</option>
  const Select = Object.assign(({ children, ...rest }: Props) => <select {...strip(rest)}>{children}</select>, { Option: SelectOption })
  const FormControlLabel = ({ children, ...rest }: Props) => <label {...strip(rest)}>{children}</label>
  const FormControlCaption = ({ children, ...rest }: Props) => <span {...strip(rest)}>{children}</span>
  const FormControl = Object.assign(({ children, ...rest }: Props) => <div {...strip(rest)}>{children}</div>, { Label: FormControlLabel, Caption: FormControlCaption })
  return { Checkbox, TextInput, Select, FormControl }
})

vi.mock('../shared/copy', () => ({ copy: (key: string) => key }))

vi.mock('../shared/SecretPicker', () => ({
  SecretRefPicker: () => <div data-testid="stub-secret-ref-picker" />,
}))

vi.mock('../configure/EntityRefField', () => ({
  EntityRefField: ({ refKind, value }: { refKind: string; value: string; onChange: (id: string) => void }) => (
    <div data-testid="stub-entity-ref-field" data-ref-kind={refKind} data-value={value} />
  ),
}))

const { ExtensionSettingControl } = await import('./ExtensionSettingControl')

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement('div')
  document.body.append(container)
  useExtensionSettingsStore.setState({ values: {} })
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.clearAllMocks()
})

function mount(decl: ExtensionSettingDecl, extensionId = 'mill-live-view'): void {
  root = createRoot(container)
  act(() => {
    root.render(<ExtensionSettingControl extensionId={extensionId} setting={decl} />)
  })
}

describe('ExtensionSettingControl renders each declared setting type (goal 0258, extended by 0400)', () => {
  it('entityRef: renders EntityRefField with the declared entityKind and the stored value, not a second list UI', () => {
    useExtensionSettingsStore.setState({ values: { 'mill-live-view': { integrationId: 'req-1' } } })
    mount({ key: 'integrationId', label: 'Integration', description: 'd', type: 'entityRef', defaultValue: '', entityKind: 'request' })

    const field = container.querySelector('[data-testid="stub-entity-ref-field"]')
    expect(field).not.toBeNull()
    expect(field?.getAttribute('data-ref-kind')).toBe('request')
    expect(field?.getAttribute('data-value')).toBe('req-1')
    expect(container.querySelector('[data-testid="extension-setting-mill-live-view-integrationId"]')?.getAttribute('data-setting-type')).toBe('entityRef')
    // Never the secretRef picker for an entityRef setting.
    expect(container.querySelector('[data-testid="stub-secret-ref-picker"]')).toBeNull()
  })

  it('entityRef: an unset value renders the picker with an empty stored value (the picker owns its own empty state)', () => {
    mount({ key: 'integrationId', label: 'Integration', description: 'd', type: 'entityRef', defaultValue: '', entityKind: 'request' })
    expect(container.querySelector('[data-testid="stub-entity-ref-field"]')?.getAttribute('data-value')).toBe('')
  })

  it('secretRef still renders the vault picker, not EntityRefField', () => {
    mount({ key: 'auth', label: 'Authorization', description: 'd', type: 'secretRef', defaultValue: '' })
    expect(container.querySelector('[data-testid="stub-secret-ref-picker"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="stub-entity-ref-field"]')).toBeNull()
  })
})
