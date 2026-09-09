// A plugin's own context keys (goal 0349 S2c): the extension-host
// "setContext" pattern -- a plugin contributes a fact the HOST holds
// and evaluates a declared item's `when` clause against, synchronously,
// on the plugin's behalf. The one door a sandboxed frame has for
// answering "should this item show?" at all: it cannot answer that
// question itself, synchronously, across a postMessage boundary.

/** A context value: the same scalar/string-array shape a `when`
 * clause's facts already carry. */
export type PluginContextValue = string | number | boolean | readonly string[]

export interface PluginContextAPI {
  /** Sets one of THIS plugin's own context keys, read back by any
   * declared item's `when` clause as `plugin.<key>` (never a fully
   * qualified key: writing under another plugin's namespace is not
   * possible through this door). Fires no host action itself -- a
   * `when` referencing the key simply reads the new value the next
   * time it is evaluated. */
  set: (key: string, value: PluginContextValue) => void
}
