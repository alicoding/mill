// A routed pane surface's address: `#/<prefix>/<id>`, with the bare
// prefix meaning the surface's default pane. The main window's other
// destinations are store views, not hash routes -- a surface gets one
// because a pane is a place a user lands on and comes back to, and the
// hash is the only address this webview has (production asset serving
// has no SPA fallback, app/main.tsx's own note). The aux-window routes
// main.tsx branches on before mount (#/quickpanel, #/traypanel, ...) are
// unaffected: none of them shares a prefix with a routed surface.
//
// One factory, two surfaces (Settings' groups, Configure's kinds): the
// decode/encode pair, the per-device memory of the last pane, and the
// replaceState discipline are the same contract for both, so each
// surface instantiates this with its own prefix and resolver rather
// than carrying a copy.
export interface HashRoute<ID extends string> {
  // fromHash decodes a raw hash string. Pure, so the mapping is
  // unit-testable without a DOM. null means "this hash is not this
  // surface's route at all" -- distinct from the bare prefix, which IS
  // one and means the default pane.
  fromHash(hash: string): ID | null
  hashFor(id: ID): string
  isHash(hash: string): boolean
  // Remembered per device (localStorage, not the settings service):
  // which pane you were last reading is this machine's own convenience.
  readLast(): ID
  remember(id: ID): void
  // write / clear keep the address bar in step with the pane without
  // adding history entries: replaceState, so the back gesture still
  // leaves the surface rather than walking its panes.
  write(id: ID): void
  clear(): void
}

export interface HashRouteSpec<ID extends string> {
  prefix: string
  storageKey: string
  fallback: ID
  // resolve maps any incoming route value onto a real pane id, falling
  // back to the surface's default -- the same resolver the view uses
  // for an incoming deep link.
  resolve: (value: string | undefined | null) => ID
}

export function defineHashRoute<ID extends string>(spec: HashRouteSpec<ID>): HashRoute<ID> {
  const { prefix, storageKey, fallback, resolve } = spec

  const fromHash = (hash: string): ID | null => {
    if (hash !== prefix && !hash.startsWith(`${prefix}/`)) return null
    const rest = hash.slice(prefix.length).replace(/^\//, '')
    return rest === '' ? fallback : resolve(rest)
  }
  const hashFor = (id: ID): string => `${prefix}/${id}`
  const isHash = (hash: string): boolean => fromHash(hash) !== null

  return {
    fromHash,
    hashFor,
    isHash,
    readLast: () => {
      try {
        return resolve(localStorage.getItem(storageKey))
      } catch {
        return fallback
      }
    },
    remember: (id) => {
      try {
        localStorage.setItem(storageKey, id)
      } catch {
        // Per-device convenience only -- a browser refusing storage just
        // means the next visit starts on the remembered-nothing default.
      }
    },
    write: (id) => {
      const next = hashFor(id)
      if (window.location.hash === next) return
      history.replaceState(null, '', window.location.pathname + window.location.search + next)
    },
    clear: () => {
      if (!isHash(window.location.hash)) return
      history.replaceState(null, '', window.location.pathname + window.location.search)
    },
  }
}
