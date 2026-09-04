export interface PluginNoticeInput {
    text: string;
    /** Defaults to 'info'. info/success dismiss themselves after a few
     * seconds; warning/error stay until the person dismisses them. */
    level?: 'info' | 'success' | 'warning' | 'error';
    /** Names one of this plugin's OWN registered commands (the id given
     * to registerCommand) as a secondary link on the notice. */
    action?: {
        label: string;
        commandId: string;
    };
}
