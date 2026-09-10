// A plugin's own context keys (goal 0349 S2c): the extension-host
// "setContext" pattern -- a plugin contributes a fact the HOST holds
// and evaluates a declared item's `when` clause against, synchronously,
// on the plugin's behalf. The one door a sandboxed frame has for
// answering "should this item show?" at all: it cannot answer that
// question itself, synchronously, across a postMessage boundary.

/** A context value is null, a string, a finite number, a boolean, or
 * a flat array containing those scalar values. Arrays are copied when
 * accepted. Objects, nested arrays and non-finite numbers are refused. */
export type PluginContextValue = string | number | boolean | null | readonly (string | number | boolean | null)[]

export interface PluginContextAPI {
  /** Sets one of THIS plugin's own context keys, read back by command
   * `enablement` or menu `when` as `plugin.<key>` (never a fully
   * qualified key: writing under another plugin's namespace is not
   * possible through this door). Fires no host action itself. A
   * declarative expression reads the new value when next evaluated. */
  set: (key: string, value: PluginContextValue) => void
}
