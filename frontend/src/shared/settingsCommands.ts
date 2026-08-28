import type { Command } from './commands'
import { useAppStore } from './store'
import { BackupService, SettingsService, UpdateState } from './bindings'
import { SETTINGS_SECTIONS, resolveSectionTitle } from './settingsSections'
import { useUpdateNoticeStore } from './updateNoticeStore'
import { useUISignalStore } from './uiSignalStore'

// Settings-adjacent commands (panel.applyClipboard, backup.*, and one
// palette-only deep-link command per registered Settings section) --
// split out of shared/commands.ts (CLAUDE.md's 500-line convention),
// spread into its COMMANDS array.
export const SETTINGS_COMMANDS: Command[] = [
  {
    id: 'settings.open',
    label: 'Open Settings',
    // Moved from shared/commands.ts (goal 0222 S2) to sit beside its own
    // Quick Panel row -- quickPanelActionEntries.tsx overrides run() to
    // open the MAIN window's Settings instead of this setView call,
    // which only makes sense inside the main window's own React tree.
    defaultBinding: { mods: ['cmd'], key: ',' },
    quickPanel: true,
    run: () => useAppStore.getState().setView({ kind: 'settings' }),
  },
  {
    // Quick-Panel-only (ADR-0033): brings the MAIN window forward.
    // paletteHidden -- running this from the main palette would just
    // refocus the window you're already in.
    id: 'panel.openMill',
    label: 'Open Mill',
    defaultBinding: null,
    paletteHidden: true,
    quickPanel: true,
    run: () => { void SettingsService.OpenMainWindow('') },
  },
  {
    id: 'panel.applyClipboard',
    label: 'Apply from clipboard',
    // docs/goals/0039: no default binding, same "reserve the id ahead
    // of the binding" precedent palette.open set before goal 0015 built
    // the palette -- bindable via Settings like every other command.
    // run() opens the Quick Panel (SettingsService.ShowPanel) rather
    // than performing the read-clipboard-and-preview flow here: that
    // flow needs a preview UI to render into, and the Quick Panel's own
    // "Apply from clipboard..." row (QuickPanel.tsx) is that UI -- this
    // command exists so the action is discoverable/rebindable/
    // HotkeyHint-shown, not to duplicate the flow in the main window.
    // quickPanelActionEntries.tsx overrides run() with the panel's own
    // applyFromClipboard flow when THIS row fires from inside the panel
    // itself (calling ShowPanel() there would just no-op-reopen it).
    defaultBinding: null,
    quickPanel: true,
    run: () => { void SettingsService.ShowPanel() },
  },
  {
    id: 'backup.now',
    label: 'Back up now',
    defaultBinding: null,
    // BackupService.BackupNow(0) matches the Settings Data stewardship
    // section's own call (views/DataStewardshipSection.tsx) -- 0 keeps
    // whatever retention count is already configured there, never
    // resets it.
    run: () => { BackupService.BackupNow(0).catch(console.error) },
  },
  {
    id: 'backup.export',
    label: 'Export everything',
    // Deep-links to Settings rather than calling
    // BackupService.ExportEverything() directly -- the export flow has
    // its own confirm/download UI there (views/DataStewardshipSection.tsx),
    // the same "the flow needs its own dialog" reasoning every other
    // settings.open.* deep-link command below already follows.
    defaultBinding: null,
    run: () => useAppStore.getState().setView({ kind: 'settings', section: 'backups' }),
  },
  // One palette-only deep-link command per registered Settings section
  // (goal 0077, shared/settingsSections.ts) -- always unbound
  // (defaultBinding: null), discoverable only by searching the palette,
  // same "reserve the id without a combo" shape panel.applyClipboard
  // above already uses.
  ...SETTINGS_SECTIONS.map((section): Command => ({
    id: `settings.open.${section.id}`,
    label: `Open Settings → ${resolveSectionTitle(section)}`,
    defaultBinding: null,
    run: () => useAppStore.getState().setView({ kind: 'settings', section: section.id }),
  })),
  // The one update state machine's own commands (goal 0220 S1) -- the
  // pill and the Settings primary button both call these, never their
  // own parallel SettingsService calls, so every surface performs the
  // exact same action for a given state. downloadAndInstall/relaunch's
  // own enabled() (goal 0222 S1) reads shared/updateNoticeStore.ts --
  // the same store NoticePill itself renders off -- so run() no longer
  // guards inline; a caller that skips checking enabled() first (there
  // is none left, but the contract holds regardless) simply fires the
  // action against whatever state the server is actually in.
  {
    id: 'update.check',
    label: 'Check for updates',
    defaultBinding: null,
    quickPanel: true,
    run: () => { SettingsService.CheckForUpdates().catch(console.error) },
  },
  {
    id: 'update.downloadAndInstall',
    label: 'Download the update and install',
    defaultBinding: null,
    enabled: () => useUpdateNoticeStore.getState().updateNoticeState === UpdateState.UpdateStateAvailable,
    quickPanel: true,
    run: () => { SettingsService.DownloadAndInstallUpdate().catch(console.error) },
  },
  {
    id: 'update.relaunch',
    label: 'Restart to finish updating',
    defaultBinding: null,
    enabled: () => useUpdateNoticeStore.getState().updateNoticeState === UpdateState.UpdateStateReady,
    quickPanel: true,
    run: () => { SettingsService.RestartApp().catch(console.error) },
  },
  {
    // "What's new" (goal 0220 S2): opens app/WhatsNewDialog.tsx, the
    // Settings status-line link and the pill's secondary link's only
    // run() -- always enabled, since opening with no notes known yet
    // is exactly the dialog's own empty state, not an invalid command.
    id: 'update.whatsNew',
    label: "What's new",
    defaultBinding: null,
    run: () => useUISignalStore.getState().openWhatsNew(),
  },
  {
    // Trust Mill's signing certificate (goal 0220 S3): replaces the
    // former "find it in Keychain Access" instructions with one call
    // at the codesigning adapter's existing seam. Always enabled --
    // the command only ever renders while views/TrustDisclosure.tsx's
    // own section is showing (already gated on "not yet trusted" via
    // trustDisclosureVisible), and the underlying write is idempotent
    // and safe to re-run regardless of prior state.
    id: 'update.trustSigning',
    label: "Trust Mill's signing",
    defaultBinding: null,
    run: () => useUpdateNoticeStore.getState().runTrustSigning(),
  },
]
