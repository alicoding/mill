import type { Command } from './commands'
import { useAppStore } from './store'
import { BackupService, SettingsService, UpdateState } from './bindings'
import { SETTINGS_SECTIONS, resolveSectionTitle } from './settingsSections'

// Settings-adjacent commands (panel.applyClipboard, backup.*, and one
// palette-only deep-link command per registered Settings section) --
// split out of shared/commands.ts (CLAUDE.md's 500-line convention),
// spread into its COMMANDS array.
export const SETTINGS_COMMANDS: Command[] = [
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
    defaultBinding: null,
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
  // exact same action for a given state. Each run() re-reads
  // UpdateNoticeState itself and no-ops outside its own state, an
  // inline guard against a stale palette entry, pill, or button firing
  // from the wrong state -- goal 0222 will replace this with
  // declarative per-command enablement; until then it stays inline
  // per the registry's existing practice (see workflow.save/
  // workflow.run's own isWorkflowEditorTabActive guards above).
  {
    id: 'update.check',
    label: 'Check for updates',
    defaultBinding: null,
    run: () => { SettingsService.CheckForUpdates().catch(console.error) },
  },
  {
    id: 'update.downloadAndInstall',
    label: 'Download the update and install',
    defaultBinding: null,
    run: () => {
      SettingsService.UpdateNoticeState()
        .then((n) => {
          if (n.state !== UpdateState.UpdateStateAvailable) return
          return SettingsService.DownloadAndInstallUpdate()
        })
        .catch(console.error)
    },
  },
  {
    id: 'update.relaunch',
    label: 'Restart to finish updating',
    defaultBinding: null,
    run: () => {
      SettingsService.UpdateNoticeState()
        .then((n) => {
          if (n.state !== UpdateState.UpdateStateReady) return
          return SettingsService.RestartApp()
        })
        .catch(console.error)
    },
  },
]
