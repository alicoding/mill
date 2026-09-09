export interface PluginSettingsAPI {
    /** Answers the stored value, or the manifest's declared default when
     * nothing has been set yet. Throws for a key the manifest does not
     * declare, naming the plugin. A secretRef setting answers the picked
     * secret's TITLE ('' when none is picked, or it no longer exists) —
     * never the value itself. The pick can name a vault entry or a key
     * from a configured source; either way, only the title ever reaches
     * plugin code. An entityRef setting answers the picked Configure
     * entity's own id ('' when none is picked) — the same id its own
     * doors already take, never a label. */
    get: (key: string) => boolean | string | number;
    /** Fires fn whenever the user changes this key, and returns the
     * unsubscribe function. Use it to redraw a face that depends on a
     * setting — renderFace itself only re-runs on the object's own data
     * changing. */
    onChange: (key: string, fn: (value: boolean | string | number) => void) => () => void;
}
