// The appearance a rendered surface (a canvas object's face, a work
// tab, a capture) is drawing under, and how it learns about a later
// change. Every render context in this SDK carries both.

/** The resolved light/dark appearance a face, view, or capture is
 * rendering under. The same mode/scheme pair is set as
 * data-mill-theme/data-mill-scheme on the element you are drawing
 * into, so plain CSS can branch on it without reading this object. */
export interface PluginTheme {
  /** The settled light/dark answer -- never "auto". */
  mode: 'light' | 'dark'
  /** The exact color scheme in effect, e.g. "dark_dimmed". */
  scheme: string
}

/** Subscribes cb to every later appearance change (a user switching
 * light/dark, or the OS following sunset) and returns the function
 * that unsubscribes it. */
export type PluginThemeSubscribe = (cb: (theme: PluginTheme) => void) => () => void

/** One color theme a plugin contributes, declared under
 * contributes.themes in the manifest. A theme is DATA, not code: file
 * names a CSS file inside your plugin folder holding nothing but
 * `--token: value;` declarations drawn from Mill's documented theme
 * variables. Mill layers it over the family's built-in palette, so you
 * only name the tokens you actually change. id is unique within your
 * plugin, and users see the theme in Settings > Appearance as label,
 * listed under family's picker with your plugin's name beneath it. */
export interface PluginThemeDecl {
  id: string
  label: string
  family: 'light' | 'dark'
  file: string
}
