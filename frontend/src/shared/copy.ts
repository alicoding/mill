import { DEFAULT_NAMESPACE, EN_RESOURCES } from './localeBundle'

// copy() is how a string reaches the screen from OUTSIDE a React tree.
//
// Every user-facing string in the app is a locale key
// (.claude/rules/ux-writing.md). Inside a component that is
// useTranslation()'s t(); a module-scope registry -- the command
// table, the Atlas noun descriptors, the menu skeleton -- has no tree
// to call a hook from, and shared/ can never import app/i18n.ts (the
// dependency-cruiser shared-is-a-leaf rule, and the i18next singleton
// is not yet initialized at module-eval time anyway). So a registry
// holds the KEY, and whoever renders or projects it calls copy().
//
// TWO resolvers, one bundle. Until app/i18n.ts installs i18next's own
// t() at boot, copy() walks shared/localeBundle.ts's statically-bundled
// English directly -- the same files i18next is about to load. That
// default is not a degraded mode: it is what lets the declaration-JSON
// generators (commandsDeclaration.json, menuDeclaration.json) resolve
// real English under vitest with no app boot, so userdocs/reference
// stays readable prose instead of a table of key paths.
//
// An UNRESOLVABLE key is returned verbatim, never thrown on. That is
// load-bearing, not lenient: a plugin contributes its command labels as
// plain author-written English (plugins/sdk/commands.ts), and those
// flow through the same copy() call the host's own keys do.
export type CopyParams = Record<string, string | number>

export type CopyResolver = (key: string, params?: CopyParams) => string

let installed: CopyResolver | null = null

// installCopyResolver is called once, from app/i18n.ts, with i18next's
// own t(). Everything resolved before that point (module-eval of the
// registries themselves) reads the same English out of the bundle.
export function installCopyResolver(resolver: CopyResolver): void {
  installed = resolver
}

// Test-only reset so a spec can exercise the pre-install path after
// another spec has installed a resolver into this module singleton.
export function resetCopyResolver(): void {
  installed = null
}

export function copy(key: string, params?: CopyParams): string {
  if (installed) return installed(key, params)
  return interpolate(lookup(key) ?? key, params)
}

// `ns:dotted.path`, or a bare dotted path against the default
// namespace -- i18next's own key grammar, so a key reads the same
// whether copy() or t() resolves it.
function lookup(key: string): string | null {
  const colon = key.indexOf(':')
  const namespace = colon === -1 ? DEFAULT_NAMESPACE : key.slice(0, colon)
  const path = colon === -1 ? key : key.slice(colon + 1)
  let node: unknown = EN_RESOURCES[namespace]
  for (const part of path.split('.')) {
    if (typeof node !== 'object' || node === null) return null
    node = (node as Record<string, unknown>)[part]
  }
  return typeof node === 'string' ? node : null
}

function interpolate(text: string, params?: CopyParams): string {
  if (!params) return text
  return text.replace(/\{\{(\w+)\}\}/g, (whole, name: string) => (name in params ? String(params[name]) : whole))
}
