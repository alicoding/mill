import type { Command } from './commands'
import { SettingsService } from './bindings'

// The two help actions that leave the app (goal 0332): the issue
// tracker in the default browser, and the folder Mill keeps its data
// in, in the file manager. Both are ordinary registry commands, so the
// palette reaches them exactly the way the Help menu does.
//
// Outbound, but only ever because the user chose it -- the same
// user-initiated door the update check and the docs links already use.
export const HELP_COMMANDS: Command[] = [
  {
    id: 'help.reportIssue',
    label: 'Report an issue…',
    defaultBinding: null,
    keywords: ['bug', 'issue', 'feedback', 'report'],
    menu: { path: 'help', group: 1, order: 0 },
    run: () => SettingsService.ReportIssue(),
  },
  {
    id: 'help.openDataFolder',
    label: 'Open data folder',
    defaultBinding: null,
    keywords: ['data', 'folder', 'files', 'storage', 'library'],
    menu: { path: 'help', group: 1, order: 1 },
    run: () => SettingsService.OpenDataFolder(),
  },
]
