export interface PluginCommandDecl {
    /** id is this command's slug: "<your plugin id>.<verb>". */
    id: string;
    label: string;
    run: () => void;
    /** enabled: omit for an always-valid command; provide a predicate
     * when the command only makes sense in a particular state -- the
     * palette leaves a disabled command out entirely rather than showing
     * something that does nothing. Never guard inside run() and return
     * silently instead. A default keybinding is deliberately NOT part of
     * this declaration: a shortcut for a command is assigned by the user
     * in Settings, never shipped by the plugin itself. */
    enabled?: () => boolean;
}
