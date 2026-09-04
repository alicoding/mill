import type { Command } from './commands'
import { copy } from './copy'
import { useAppStore } from './store'
import { BackupService, SettingsService, UpdateState } from './bindings'
import { SETTINGS_GROUPS, resolveGroupTitle } from './settingsGroups'
import { useUpdateNoticeStore } from './updateNoticeStore'
import { useUISignalStore } from './uiSignalStore'
import { useBuildInfoStore } from './buildInfoStore'
import { PluginService } from '../../bindings/github.com/alicoding/mill/internal/services/pluginsvc'
import { downloadBlob } from './downloadBlob'

// Settings-adjacent commands (panel.applyClipboard, backup.*, and one
// palette-only deep-link command per registered Settings section) --
// split out of shared/commands.ts (CLAUDE.md's 500-line convention),
// spread into its COMMANDS array.
export const SETTINGS_COMMANDS: Command[] = [
  {
    id: 'settings.open',
    menu: { path: 'app', group: 1, order: 0, label: 'menu.items.settings' },
    label: 'commands.settings.open',
    // Moved from shared/commands.ts (goal 0222 S2) to sit beside its own
    // Quick Panel row -- quickPanelActionEntries.tsx overrides run() to
    // open the MAIN window's Settings instead of this setView call,
    // which only makes sense inside the main window's own React tree.
    defaultBinding: { mods: ['cmd'], key: ',' },
    quickPanel: true,
    run: () => useAppStore.getState().setView({ kind: 'settings' }),
  },
  {
    // Brings the MAIN window forward -- the Quick Panel's own row
    // (ADR-0033) and the tray's "Open Mill" button (app/TrayPanel.tsx,
    // goal 0335) both fire this rather than each holding a separate
    // SettingsService.OpenMainWindow('') call. paletteHidden -- running
    // this from the main palette would just refocus the window you're
    // already in.
    id: 'panel.openMill',
    label: 'commands.panel.openMill',
    defaultBinding: null,
    paletteHidden: true,
    quickPanel: true,
    run: () => { void SettingsService.OpenMainWindow('') },
  },
  {
    id: 'panel.applyClipboard',
    label: 'commands.panel.applyClipboard',
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
    menu: { path: 'app', group: 2, order: 0, label: 'menu.items.backUpNow' },
    label: 'commands.backup.now',
    defaultBinding: null,
    // BackupService.BackupNow(0) matches the Settings Data stewardship
    // section's own call (views/DataStewardshipSection.tsx) -- 0 keeps
    // whatever retention count is already configured there, never
    // resets it.
    run: () => BackupService.BackupNow(0),
  },
  {
    id: 'capture.note',
    menu: { path: 'file', group: 0, order: 1, label: 'menu.items.newNote' },
    label: 'commands.capture.note',
    // The capture window (goal 0309): a note written away from the
    // canvas lands where the user chose.
    defaultBinding: null,
    run: () => SettingsService.ShowCapture('', 'note'),
  },
  {
    id: 'extensions.exportAudit',
    menu: { path: 'file', group: 3, order: 1 },
    label: 'commands.extensions.exportAudit',
    // The plugin audit document (ADR-0051 §4): every installed plugin's
    // reach and trust state, the guarded actions plugins asked for
    // within the guardrail window, and every plugin secret read -- saved
    // through the same download door every other export uses.
    defaultBinding: null,
    run: () =>
      PluginService.ExportPluginAudit()
        .then((json) => downloadBlob(`mill-plugin-audit-${new Date().toISOString().slice(0, 10)}.json`, new Blob([json], { type: 'application/json' }))),
  },
  {
    id: 'backup.export',
    menu: { path: 'file', group: 3, order: 0 },
    label: 'commands.backup.export',
    // Deep-links to Settings rather than calling
    // BackupService.ExportEverything() directly -- the export flow has
    // its own confirm/download UI there (views/DataStewardshipSection.tsx),
    // the same "the flow needs its own dialog" reasoning every other
    // settings.open.* deep-link command below already follows.
    defaultBinding: null,
    run: () => useAppStore.getState().setView({ kind: 'settings', section: 'backups' }),
  },
  {
    // Brings the Quick Panel (ADR-0033's second Wails window) forward,
    // the same way panel.applyClipboard already does -- ShowPanel, not
    // TogglePanel: that one stays Go-internal (`//wails:ignore`, its
    // own doc comment), reserved for the summon hotkey's dismiss-if-
    // already-visible behavior, which a menu/palette invocation never
    // needs (goal 0335).
    id: 'panel.open',
    menu: { path: 'window', group: 0, order: 0, label: 'menu.items.quickPanel' },
    label: 'commands.panel.open',
    defaultBinding: null,
    enabled: () => useBuildInfoStore.getState().isDesktop,
    run: () => SettingsService.ShowPanel(),
  },
  {
    // Brings the run monitor window forward showing whatever it last
    // had (or its own empty state if it never has) -- ShowRunMonitor's
    // own contract only replaces the shown run when workflowID is
    // non-empty (app/RunMonitor.tsx's Events.On handler), so calling it
    // with none is exactly "reveal the window" and never clears a run
    // already on screen.
    id: 'runMonitor.open',
    menu: { path: 'window', group: 0, order: 1, label: 'menu.items.runMonitor' },
    label: 'commands.runMonitor.open',
    defaultBinding: null,
    enabled: () => useBuildInfoStore.getState().isDesktop,
    run: () => SettingsService.ShowRunMonitor('', ''),
  },
  // One palette-only deep-link command per registered Settings GROUP
  // (goal 0321, shared/settingsGroups.ts) -- always unbound
  // (defaultBinding: null), discoverable only by searching the palette,
  // same "reserve the id without a combo" shape panel.applyClipboard
  // above already uses. The group argument is carried by the id, the
  // id-per-command convention every other parameterized command here
  // follows (atlas.create.<kind>, plugin.reload.<id>).
  ...SETTINGS_GROUPS.map((group): Command => ({
    id: `settings.open.${group.id}`,
    label: copy('commands.settings.openGroup', { title: resolveGroupTitle(group) }),
    defaultBinding: null,
    run: () => useAppStore.getState().setView({ kind: 'settings', section: group.id }),
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
    menu: { path: 'app', group: 0, order: 0, label: 'menu.items.checkForUpdates' },
    label: 'commands.update.check',
    defaultBinding: null,
    keywords: ['update', 'updates', 'upgrade', 'version', 'new version'],
    // One update door at a time (goal 0295): once an update is in hand
    // the download / restart command is the row, not another check.
    enabled: () => {
      const state = useUpdateNoticeStore.getState().updateNoticeState
      return state !== UpdateState.UpdateStateAvailable && state !== UpdateState.UpdateStateDownloading && state !== UpdateState.UpdateStateReady
    },
    quickPanel: true,
    run: () => { useUpdateNoticeStore.getState().runUserCheck() },
  },
  {
    id: 'update.downloadAndInstall',
    label: 'commands.update.downloadAndInstall',
    defaultBinding: null,
    keywords: ['update', 'install', 'download', 'upgrade'],
    enabled: () => useUpdateNoticeStore.getState().updateNoticeState === UpdateState.UpdateStateAvailable,
    quickPanel: true,
    run: () => SettingsService.DownloadAndInstallUpdate(),
  },
  {
    id: 'update.relaunch',
    label: 'commands.update.relaunch',
    defaultBinding: null,
    keywords: ['relaunch', 'restart', 'update', 'finish updating'],
    enabled: () => useUpdateNoticeStore.getState().updateNoticeState === UpdateState.UpdateStateReady,
    quickPanel: true,
    run: () => SettingsService.RestartApp(),
  },
  {
    // "What's new" (goal 0220 S2): opens app/WhatsNewDialog.tsx, the
    // Settings status-line link and the pill's secondary link's only
    // run() -- always enabled, since opening with no notes known yet
    // is exactly the dialog's own empty state, not an invalid command.
    id: 'update.whatsNew',
    menu: { path: 'help', group: 0, order: 2, label: 'menu.items.whatsNew' },
    label: 'commands.update.whatsNew',
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
    label: 'commands.update.trustSigning',
    defaultBinding: null,
    run: () => useUpdateNoticeStore.getState().runTrustSigning(),
  },
]
