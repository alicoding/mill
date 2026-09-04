// A plugin's own key-value store, persisted under the plugin's id --
// the same shape most extension platforms offer as private per-plugin
// state (request history, a cached list, a last-picked choice).
// Nothing outside the plugin ever reads it.

export interface PluginStorageAPI {
  /** Synchronous: reads from a cache loaded before activate() ran. */
  get: (key: string) => unknown
  /** Any JSON-serialisable value; a value that is not throws at the
   * call. Resolves once the write is durably stored. */
  set: (key: string, value: unknown) => Promise<void>
  delete: (key: string) => Promise<void>
  keys: () => string[]
}
