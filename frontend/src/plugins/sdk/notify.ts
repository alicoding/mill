// A one-call transient message Mill renders in its own notice surface,
// labelled with the plugin's name -- the standard way to report a
// failure so a person actually sees it (never console.error alone).

export interface PluginNoticeInput {
  text: string
  /** Defaults to 'info'. info/success dismiss themselves after a few
   * seconds; warning/error stay until the person dismisses them. */
  level?: 'info' | 'success' | 'warning' | 'error'
  /** Names one of this plugin's OWN registered commands (the id given
   * to registerCommand) as a secondary link on the notice. */
  action?: { label: string; commandId: string }
}
