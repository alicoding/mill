/** The resolved light/dark appearance a face, view, or capture is
 * rendering under. The same mode/scheme pair is set as
 * data-mill-theme/data-mill-scheme on the element you are drawing
 * into, so plain CSS can branch on it without reading this object. */
export interface PluginTheme {
    /** The settled light/dark answer -- never "auto". */
    mode: 'light' | 'dark';
    /** The exact color scheme in effect, e.g. "dark_dimmed". */
    scheme: string;
}
/** Subscribes cb to every later appearance change (a user switching
 * light/dark, or the OS following sunset) and returns the function
 * that unsubscribes it. */
export type PluginThemeSubscribe = (cb: (theme: PluginTheme) => void) => () => void;
