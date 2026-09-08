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
  /** Reads the array stored at key, or [] when nothing is stored there
   * yet or the stored value is not an array. */
  getList: (key: string) => Promise<unknown[]>
  /** Adds item to the front of the list stored at key (creating it
   * empty first). dedupeBy, when given, first removes any earlier
   * item it resolves to the same key as item; max, when given, then
   * trims the list to that many entries, oldest dropped first. */
  pushList: (key: string, item: unknown, opts?: { dedupeBy?: (item: unknown) => unknown; max?: number }) => Promise<void>
}
