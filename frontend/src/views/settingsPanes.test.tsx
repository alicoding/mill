// @vitest-environment jsdom
import { type ReactNode } from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import views from '../locales/en/views.json'
import secrets from '../locales/en/secrets.json'
import common from '../locales/en/common.json'
import { SETTINGS } from '../shared/settingsRegistry'
import { SETTINGS_GROUPS, type SettingsGroupID } from '../shared/settingsGroups'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// The registry/pane walk (goal 0412 S1): every SettingsRow the eight
// Settings panes render must carry a `data-setting-id` the registry
// knows (no GHOST row), and every registry entry belonging to a
// pane's group must render somewhere under that pane, in at least one
// of the states its own conditionals allow (no ORPHAN entry). A row
// gated behind live state (an org policy, an MCP toggle, the
// appearance mode) is walked once per state that reveals it.
//
// Sibling sections a pane composes that own no SettingsRow of their
// own (RemoteAccessSection, BrowsersSection, WebhooksSection,
// ContractSection, KeyboardShortcutsSection, SecretsLockingSettings,
// SettingsAuditRetention, TrustDisclosure -- confirmed by grepping
// each for SettingsRow before writing this file) are stood in for by
// a plain placeholder: this file's job is the registry/row contract,
// not re-proving those sections' own already-covered behavior.

type Props = Record<string, unknown> & { children?: ReactNode }
const strip = (rest: Props) => {
  const attrs = { ...rest }
  delete attrs.leadingVisual
  delete attrs.variant
  delete attrs.size
  delete attrs.block
  delete attrs.align
  delete attrs.justify
  delete attrs.direction
  delete attrs.gap
  delete attrs.weight
  delete attrs.icon
  delete attrs.selected
  delete attrs.selectionVariant
  delete attrs.as
  return attrs
}

// @primer/react pulls in its own stylesheet at import, which the node
// test runtime cannot load (NavRail.test.tsx/PluginFrame.test.tsx/
// RequestTestPanel.test.tsx carry the same stand-in) -- these keep the
// same slot shape (label, control, testid) so what's asserted here is
// each pane's own row wiring, not the kit's markup.
vi.mock('@primer/react', () => {
  const Stack = ({ children, ...rest }: Props) => <div {...strip(rest)}>{children}</div>
  const Text = ({ children, ...rest }: Props) => <span {...strip(rest)}>{children}</span>
  const Heading = ({ children, ...rest }: Props) => <h2 {...strip(rest)}>{children}</h2>
  const Link = ({ children, ...rest }: Props) => <a {...strip(rest)}>{children}</a>
  const Label = ({ children, ...rest }: Props) => <span {...strip(rest)}>{children}</span>
  const Button = ({ children, ...rest }: Props) => <button {...strip(rest)}>{children}</button>
  const IconButton = ({ children, ...rest }: Props) => <button {...strip(rest)}>{children}</button>
  const Checkbox = (rest: Props) => <input type="checkbox" {...strip(rest)} />
  const TextInput = (rest: Props) => <input {...strip(rest)} />
  const Textarea = (rest: Props) => <textarea {...strip(rest)} />
  const Flash = ({ children, ...rest }: Props) => <div {...strip(rest)}>{children}</div>
  const VisuallyHidden = ({ children, ...rest }: Props) => <span {...strip(rest)}>{children}</span>
  const FormControlLabel = ({ children, ...rest }: Props) => <label {...strip(rest)}>{children}</label>
  const FormControlCaption = ({ children, ...rest }: Props) => <span {...strip(rest)}>{children}</span>
  const FormControl = Object.assign(({ children, ...rest }: Props) => <div {...strip(rest)}>{children}</div>, { Label: FormControlLabel, Caption: FormControlCaption })
  const SelectOption = ({ children, ...rest }: Props) => <option {...strip(rest)}>{children}</option>
  const Select = Object.assign(({ children, ...rest }: Props) => <select {...strip(rest)}>{children}</select>, { Option: SelectOption })
  const SegmentedControlButton = ({ children, ...rest }: Props) => <button {...strip(rest)}>{children}</button>
  const SegmentedControlIconButton = (rest: Props) => <button {...strip(rest)} />
  const SegmentedControl = Object.assign(({ children, ...rest }: Props) => <div {...strip(rest)}>{children}</div>, { Button: SegmentedControlButton, IconButton: SegmentedControlIconButton })
  const ActionListItem = ({ children, ...rest }: Props) => <div {...strip(rest)}>{children}</div>
  const ActionListGroup = ({ children, ...rest }: Props) => <div {...strip(rest)}>{children}</div>
  const ActionListGroupHeading = ({ children, ...rest }: Props) => <div {...strip(rest)}>{children}</div>
  const ActionListLeadingVisual = ({ children, ...rest }: Props) => <span {...strip(rest)}>{children}</span>
  const ActionListDescription = ({ children, ...rest }: Props) => <span {...strip(rest)}>{children}</span>
  const ActionList = Object.assign(({ children, ...rest }: Props) => <div {...strip(rest)}>{children}</div>, {
    Item: ActionListItem, Group: ActionListGroup, GroupHeading: ActionListGroupHeading,
    LeadingVisual: ActionListLeadingVisual, Description: ActionListDescription,
  })
  return {
    Stack, Text, Heading, Link, Label, Button, IconButton, Checkbox, TextInput, Textarea, Flash, VisuallyHidden,
    FormControl, Select, SegmentedControl, ActionList,
  }
})

// @primer/react/experimental (goal 0405 S1's KeybindingHint, the
// summon-hotkey chip SettingsShortcutsPane.tsx now renders for real)
// pulls in its own stylesheet exactly like '@primer/react' above, and
// is a SEPARATE module specifier vi.mock('@primer/react', ...) does
// not cover.
vi.mock('@primer/react/experimental', () => ({
  KeybindingHint: ({ keys }: { keys: string }) => <kbd data-testid="keybinding-hint">{keys}</kbd>,
}))

// Resolves the real English strings from the three namespaces these
// panes read from (same pattern RequestTestPanel.test.tsx uses for
// 'configure') -- a copy regression fails this test the same way a
// snapshot of the rendered text would, and a `ns:key` reference (the
// shortcuts pane's `common:actions.change`) resolves across namespaces.
vi.mock('react-i18next', () => ({
  useTranslation: (ns?: string) => ({
    t: (key: string, vars: Record<string, unknown> = {}) => {
      const hasNamespace = key.includes(':')
      const namespace = hasNamespace ? key.slice(0, key.indexOf(':')) : (ns ?? 'views')
      const path = hasNamespace ? key.slice(key.indexOf(':') + 1) : key
      const dict = namespace === 'secrets' ? secrets : namespace === 'common' ? common : views
      const value = path.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], dict)
      if (typeof value !== 'string') return key
      return value.replace(/\{\{(\w+)\}\}/g, (_: string, name: string) => String(vars[name] ?? ''))
    },
  }),
}))

vi.mock('@wailsio/runtime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@wailsio/runtime')>()
  return { ...actual, Events: { ...actual.Events, On: () => () => undefined } }
})

vi.mock('../shared/bindings', async () => {
  const { UpdateState } = await import('../../bindings/github.com/alicoding/mill/internal/services/settingssvc')
  const resolved = <T,>(value: T) => vi.fn(() => Promise.resolve(value))
  return {
    UpdateState,
    SettingsService: {
      GetLaunchAtLogin: resolved('disabled'),
      SetLaunchAtLogin: resolved(undefined),
      GetDisplayDensity: resolved('comfortable'),
      SetDisplayDensity: resolved(undefined),
      GetSummonHotkey: resolved(''),
      SuspendMenuAccelerators: resolved(undefined),
      RestoreMenuAccelerators: resolved(undefined),
      GetMCPWriteEnabled: resolved(false),
      GetMCPWriteApprovalRequired: resolved(true),
      SetMCPWriteEnabled: resolved(undefined),
      SetMCPWriteApprovalRequired: resolved(undefined),
      MCPAccessAddressInfo: resolved({ address: '', envOverride: false }),
      SetMCPAccessAddress: resolved(undefined),
      GetAttentionIdleThreshold: resolved(300),
      SetAttentionIdleThreshold: resolved(undefined),
      GetAuditRetentionEntries: resolved(1000),
      SetAuditRetentionEntries: resolved(undefined),
      AppVersion: resolved('0.0.0-test'),
      GetBuildInfo: resolved({
        Revision: 'test', Modified: false, Server: false, BuiltAt: 1,
        BuildChannel: 'source', LocalBuild: true,
      }),
      UpdateChannel: resolved('source'),
      UpdateChannelPreference: resolved(''),
      SetUpdateChannelPreference: resolved(undefined),
      AutoUpdateCheck: resolved(false),
      SetAutoUpdateCheck: resolved(undefined),
      UpdateCheckInterval: resolved('hourly'),
      SetUpdateCheckInterval: resolved(undefined),
      OutboundProxyURL: resolved(''),
      SetOutboundProxyURL: resolved(undefined),
      UpdateNoticeState: resolved({
        state: UpdateState.UpdateStateIdle, stateReason: '', stateReasonStage: '', stateVersion: '',
        lastCheckAt: '', lastCheckOutcome: '', lastCheckError: '',
      }),
      CheckForUpdates: resolved({ updateAvailable: false, version: '', currentVersion: '0.0.0-test' }),
    },
    SecretService: {
      UnlockCapability: resolved('none'),
      SetTouchIDProtection: resolved(undefined),
      VaultStatus: resolved({ Unlocked: true, RequireAuth: false, AuthAvailable: false }),
      VaultLockPolicy: resolved({ LockAfterSeconds: 900, LockOnSleep: true, LockOnUserSwitch: true, LockOnMinimize: false }),
      SetVaultLockPolicy: resolved(undefined),
    },
    BackupService: {
      GetBackupStatus: resolved({ available: true, dir: '/tmp/mill-backups', hasBackup: false, lastBackupAt: '' }),
      LatestVaultBackupTime: resolved({ Present: false }),
    },
  }
})

vi.mock('../../bindings/github.com/alicoding/mill/internal/services/pluginsvc', () => ({
  PluginService: { PluginPolicy: vi.fn(() => Promise.resolve(unmanagedPolicy())) },
}))

vi.mock('../shared/commands', () => ({
  runCommand: vi.fn(),
  findCommand: vi.fn(() => undefined),
  COMMANDS: [],
  commandLabel: (id: string) => id,
  effectiveBinding: () => null,
}))

// Sibling sections with no SettingsRow of their own (verified by grep
// before writing this file) -- stood in so mounting a pane never
// exercises their own separately-tested surfaces (device pairing,
// browser bridge, webhook minting, the full command table, the
// vault's lock-policy form, the audit retention field, the trust
// disclosure panel).
vi.mock('./RemoteAccessSection', () => ({ default: () => <div data-testid="stub-remote-access" /> }))
vi.mock('./BrowsersSection', () => ({ default: () => <div data-testid="stub-browsers" /> }))
vi.mock('./WebhooksSection', () => ({ default: () => <div data-testid="stub-webhooks" /> }))
vi.mock('./ContractSection', () => ({ default: () => <div data-testid="stub-contract" /> }))
vi.mock('./KeyboardShortcutsSection', () => ({ default: () => <div data-testid="stub-keyboard-shortcuts" /> }))
vi.mock('./SecretsLockingSettings', () => ({ default: () => <div data-testid="stub-secrets-locking" /> }))
vi.mock('./SettingsAuditRetention', () => ({ default: () => <div data-testid="stub-audit-retention" /> }))
vi.mock('./TrustDisclosure', () => ({ TrustDisclosure: () => <div data-testid="stub-trust-disclosure" /> }))

function unmanagedPolicy() {
  return { Managed: false, ManagedBy: '', RequiredTier: '', BlockedCapabilities: [], AllowedSources: [], AllowCount: 0, BlockCount: 0, Path: '', Error: '' }
}
function managedPolicy() {
  return { Managed: true, ManagedBy: 'IT', RequiredTier: '', BlockedCapabilities: [], AllowedSources: [], AllowCount: 0, BlockCount: 0, Path: '/etc/mill/policy.json', Error: '' }
}

const { usePluginPolicyStore } = await import('../shared/pluginPolicyStore')
const { useVaultStatusStore } = await import('../shared/vaultStatusStore')
const { refreshBuildInfo, useBuildInfoStore } = await import('../shared/buildInfoStore')
const { getAppearance, setAppearance } = await import('../shared/appearance')
const { PluginService } = await import('../../bindings/github.com/alicoding/mill/internal/services/pluginsvc')
const { SettingsService } = await import('../shared/bindings')

const SettingsGeneralPane = (await import('./SettingsGeneralPane')).default
const AppearanceSection = (await import('./AppearanceSection')).default
const SettingsSecurityPane = (await import('./SettingsSecurityPane')).default
const SettingsShortcutsPane = (await import('./SettingsShortcutsPane')).default
const SettingsConnectionsPane = (await import('./SettingsConnectionsPane')).default
const SettingsNotificationsPane = (await import('./SettingsNotificationsPane')).default
const DataStewardshipSection = (await import('./DataStewardshipSection')).default
const UpdatesSection = (await import('./UpdatesSection')).default

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement('div')
  document.body.append(container)
  usePluginPolicyStore.setState({ policy: null })
  useVaultStatusStore.setState({ vaultStatus: null, vaultError: null, vaultBackupTime: null })
  useBuildInfoStore.setState({ isDesktop: false, buildInfo: null })
  vi.mocked(SettingsService.UpdateChannel).mockResolvedValue('source')
  vi.mocked(SettingsService.AutoUpdateCheck).mockResolvedValue(false)
  vi.mocked(SettingsService.UpdateCheckInterval).mockResolvedValue('hourly')
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.clearAllMocks()
})

async function mount(node: ReactNode): Promise<void> {
  root = createRoot(container)
  await act(async () => {
    root.render(node)
  })
  // Drains the chained .then()s a mount effect fires (e.g. Security's
  // vault-status read, then Extension Policy's own policy read) --
  // several ticks so a second-order fetch triggered by the first one
  // landing also resolves before assertions run.
  for (let i = 0; i < 4; i++) {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
  }
}

function renderedSettingIds(): string[] {
  return Array.from(container.querySelectorAll('[data-testid="settings-row"]'))
    .map((el) => el.getAttribute('data-setting-id'))
    .filter((id): id is string => id !== null)
}

function registryIdsFor(group: SettingsGroupID): string[] {
  return SETTINGS.filter((s) => s.group === group).map((s) => s.id)
}

describe('Settings panes render exactly their registry entries (goal 0412 S1)', () => {
  it('General: all three rows render, matching the registry exactly', async () => {
    await mount(<SettingsGeneralPane />)
    expect(new Set(renderedSettingIds())).toEqual(new Set(registryIdsFor('general')))
  })

  it('Appearance: light mode renders colorMode/theme/density -- no ghost, no orphan across all three modes', async () => {
    setAppearance({ mode: 'light', lightScheme: 'light', darkScheme: 'dark' })
    await mount(<AppearanceSection />)
    const rendered = renderedSettingIds()
    expect(rendered.every((id) => registryIdsFor('appearance').includes(id))).toBe(true)
    expect(new Set(rendered)).toEqual(new Set(['appearance.colorMode', 'appearance.theme', 'appearance.density']))
  })

  it('Appearance: dark mode renders the same shape with the dark theme picker', async () => {
    setAppearance({ mode: 'dark', lightScheme: 'light', darkScheme: 'dark' })
    await mount(<AppearanceSection />)
    expect(new Set(renderedSettingIds())).toEqual(new Set(['appearance.colorMode', 'appearance.theme', 'appearance.density']))
  })

  it('Appearance: auto mode renders both theme rows instead of the single one -- union covers every appearance entry', async () => {
    setAppearance({ mode: 'auto', lightScheme: 'light', darkScheme: 'dark' })
    await mount(<AppearanceSection />)
    const rendered = new Set(renderedSettingIds())
    expect(rendered).toEqual(new Set(['appearance.colorMode', 'appearance.lightTheme', 'appearance.darkTheme', 'appearance.density']))
    // Every appearance registry entry rendered in at least one of the
    // three mode states this suite walks (no orphan across the union).
    const union = new Set([
      ...rendered,
      'appearance.theme', // covered by the light/dark-mode cases above
    ])
    expect(union).toEqual(new Set(registryIdsFor('appearance')))
    expect(getAppearance().mode).toBe('auto')
  })

  it('Security: an unmanaged policy renders none of the extension-policy rows (no ghost)', async () => {
    useVaultStatusStore.setState({ vaultStatus: { Unlocked: true, RequireAuth: false, AuthAvailable: false, Exists: true } })
    vi.mocked(PluginService.PluginPolicy).mockResolvedValue(unmanagedPolicy())
    await mount(<SettingsSecurityPane />)
    expect(renderedSettingIds()).toEqual([])
  })

  it('Security: a managed policy renders all six extension-policy rows, matching the registry exactly', async () => {
    useVaultStatusStore.setState({ vaultStatus: { Unlocked: true, RequireAuth: false, AuthAvailable: false, Exists: true } })
    vi.mocked(PluginService.PluginPolicy).mockResolvedValue(managedPolicy())
    await mount(<SettingsSecurityPane />)
    expect(new Set(renderedSettingIds())).toEqual(new Set(registryIdsFor('security')))
  })

  it('Shortcuts: the global hotkey row renders, matching the registry exactly', async () => {
    await mount(<SettingsShortcutsPane />)
    expect(new Set(renderedSettingIds())).toEqual(new Set(registryIdsFor('shortcuts')))
  })

  it('Connections: MCP import off renders the address and allow-import rows only', async () => {
    await mount(<SettingsConnectionsPane />)
    const rendered = renderedSettingIds()
    expect(rendered.every((id) => registryIdsFor('connections').includes(id))).toBe(true)
    expect(new Set(rendered)).toEqual(new Set(['connections.mcpAddress', 'connections.mcpAllowImport']))
  })

  it('Connections: MCP import on also renders ask-before-import -- union covers every connections entry', async () => {
    const { SettingsService } = await import('../shared/bindings')
    vi.mocked(SettingsService.GetMCPWriteEnabled).mockResolvedValue(true)
    await mount(<SettingsConnectionsPane />)
    expect(new Set(renderedSettingIds())).toEqual(new Set(registryIdsFor('connections')))
  })

  it('Notifications: both rows render, matching the registry exactly', async () => {
    await mount(<SettingsNotificationsPane />)
    expect(new Set(renderedSettingIds())).toEqual(new Set(registryIdsFor('notifications')))
  })

  it('Backups: no SettingsRow renders -- the registry has no backups entries either', async () => {
    await mount(<DataStewardshipSection />)
    expect(renderedSettingIds()).toEqual([])
    expect(registryIdsFor('backups')).toEqual([])
  })

  it('Updates: no SettingsRow renders -- the registry has no updates entries either', async () => {
    await mount(<UpdatesSection />)
    expect(renderedSettingIds()).toEqual([])
    expect(registryIdsFor('updates')).toEqual([])
  })

  it('the registry names every group SETTINGS_GROUPS declares, and nothing else', () => {
    const knownGroups = new Set(SETTINGS_GROUPS.map((g) => g.id))
    for (const setting of SETTINGS) {
      expect(knownGroups.has(setting.group), `${setting.id} belongs to a real group`).toBe(true)
    }
  })
})

function buildInfo(BuildChannel: string, LocalBuild: boolean) {
  return { Revision: 'test', Modified: false, Server: false, BuiltAt: 1, BuildChannel, LocalBuild }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

describe('Updates renders the effective automatic-update policy', () => {
  it.each([
    [false, 'hourly', true, 'Checks when you open Updates or choose Check for updates. Downloads must be started manually.'],
    [true, 'hourly', true, 'Checks for updates on the schedule below. This local build does not download updates automatically.'],
    [true, 'manual', true, 'Checks when you open Updates or check manually; this local build requires manual downloads.'],
    [true, 'daily', false, 'Checks for updates on the schedule below and downloads available updates automatically.'],
    [true, 'manual', false, 'Checks when you open Updates or check manually, then downloads available updates automatically.'],
  ] as const)('auto=%s interval=%s local=%s', async (autoCheck, interval, localBuild, expected) => {
    useBuildInfoStore.setState({ isDesktop: true, buildInfo: buildInfo(localBuild ? 'source' : 'release', localBuild) })
    vi.mocked(SettingsService.AutoUpdateCheck).mockResolvedValueOnce(autoCheck)
    vi.mocked(SettingsService.UpdateCheckInterval).mockResolvedValueOnce(interval)

    await mount(<UpdatesSection />)

    expect(container.querySelector('#automatic-updates-caption')?.textContent).toBe(expected)
  })

  it('keeps source-build origin and policy when the selected feed is beta', async () => {
    useBuildInfoStore.setState({ isDesktop: true, buildInfo: buildInfo('source', true) })
    vi.mocked(SettingsService.UpdateChannel).mockResolvedValueOnce('beta')
    vi.mocked(SettingsService.AutoUpdateCheck).mockResolvedValueOnce(true)

    await mount(<UpdatesSection />)

    expect(container.querySelector('[data-testid="build-origin"]')?.textContent).toBe('local build')
    expect(container.querySelector('#automatic-updates-caption')?.textContent)
      .toBe('Checks for updates on the schedule below. This local build does not download updates automatically.')
  })

  it('omits origin and automatic-download claims while build metadata is pending', async () => {
    vi.mocked(SettingsService.AutoUpdateCheck).mockResolvedValueOnce(true)

    await mount(<UpdatesSection />)

    expect(container.querySelector('[data-testid="build-origin"]')).toBeNull()
    expect(container.querySelector('#automatic-updates-caption')).toBeNull()

    await act(async () => {
      useBuildInfoStore.getState().setBuildInfo(buildInfo('beta', false))
    })
    expect(container.querySelector('[data-testid="build-origin"]')?.textContent).toBe('beta build')
    expect(container.querySelector('#automatic-updates-caption')?.textContent)
      .toBe('Checks for updates on the schedule below and downloads available updates automatically.')
  })

  it('omits scheduled claims until a deferred persisted cadence resolves', async () => {
    const cadence = deferred<string>()
    useBuildInfoStore.setState({ isDesktop: true, buildInfo: buildInfo('source', true) })
    vi.mocked(SettingsService.AutoUpdateCheck).mockResolvedValueOnce(true)
    vi.mocked(SettingsService.UpdateCheckInterval).mockReturnValueOnce(
      cadence.promise as ReturnType<typeof SettingsService.UpdateCheckInterval>,
    )

    await mount(<UpdatesSection />)

    expect((container.querySelector('[data-testid="auto-update-check"]') as HTMLInputElement).disabled).toBe(false)
    expect(container.querySelector('#automatic-updates-caption')).toBeNull()
    expect(container.querySelector('[data-testid="update-check-interval-select"]')).toBeNull()

    await act(async () => {
      cadence.resolve('manual')
      await cadence.promise
    })
    expect(container.querySelector('[data-testid="update-check-interval-select"]')).not.toBeNull()
    expect(container.querySelector('#automatic-updates-caption')?.textContent)
      .toBe('Checks when you open Updates or check manually; this local build requires manual downloads.')
  })

  it('disables the automatic-update control until its initial value resolves', async () => {
    const autoCheck = deferred<boolean>()
    vi.mocked(SettingsService.AutoUpdateCheck).mockReturnValueOnce(
      autoCheck.promise as ReturnType<typeof SettingsService.AutoUpdateCheck>,
    )

    await mount(<UpdatesSection />)

    expect((container.querySelector('[data-testid="auto-update-check"]') as HTMLInputElement).disabled).toBe(true)
    await act(async () => {
      autoCheck.resolve(false)
      await autoCheck.promise
    })
    expect((container.querySelector('[data-testid="auto-update-check"]') as HTMLInputElement).disabled).toBe(false)
  })

  it('keeps metadata unknown after the existing background error path records a failed fetch', async () => {
    vi.mocked(SettingsService.GetBuildInfo).mockRejectedValueOnce(new Error('metadata unavailable'))
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    await refreshBuildInfo()
    vi.mocked(SettingsService.AutoUpdateCheck).mockResolvedValueOnce(true)
    await mount(<UpdatesSection />)

    expect(warning).toHaveBeenCalledWith('[background:buildInfo.getBuildInfo]', expect.any(Error))
    expect(container.querySelector('[data-testid="build-origin"]')).toBeNull()
    expect(container.querySelector('#automatic-updates-caption')).toBeNull()
    warning.mockRestore()
  })
})
