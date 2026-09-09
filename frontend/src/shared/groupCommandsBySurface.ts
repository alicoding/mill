import type { Command } from './commandTypes'
import { commandLabel, effectiveBinding } from './commands'
import { comboKey, type KeyCombo } from './keybinding'
import type { View } from './viewKinds'

// The keyboard-shortcuts-editor precedent's own grouping rule (goal
// 0405 S1, docs/goals/0405-shortcuts-editor-precedent.md Decision 1):
// bound-first per surface, the unbound tail collapsed rather than
// dropped. One projection feeds both the Settings editor
// (views/KeyboardShortcutsSection.tsx, every command) and the
// shortcuts-help overlay (app/ShortcutsHelpDialog.tsx, bound-only,
// which buckets by "on this page" vs "everywhere" instead of the full
// surface taxonomy below -- it reads `groups` directly rather than
// calling this with a pre-filtered list, so its own on-page/everywhere
// split stays exactly as before).

export type SurfaceKey = View['kind'] | 'everywhere'

export interface SurfaceGroup {
  surface: SurfaceKey
  // A views: locale KEY (KeyboardShortcutsSection.tsx's own namespace),
  // not resolved English -- this module is shared/ module-scope, no
  // React tree to call t() from (shared/commands.ts's own commandLabel()
  // doc comment covers the same reasoning). The one caller that renders
  // group labels (KeyboardShortcutsSection.tsx) resolves it with its
  // own t(); ShortcutsHelpDialog.tsx never reads this field (Decision 6:
  // it keeps its existing "On this page"/"Everywhere" copy).
  label: string
  bound: Command[]
  unbound: Command[]
  customisedCount: number
}

// Every surface a command can declare today (shared/*Commands.ts) --
// keyed by View['kind'] so a future surface fails to compile here
// until it's given a label key, rather than silently falling back to
// its raw kind string. A command with no `surface` at all is global
// ("Everywhere" -- dispatches on every view, goal 0071's own scoping
// rule).
const SURFACE_LABEL_KEY: Partial<Record<View['kind'], string>> = {
  atlas: 'keyboardShortcutsSection.surfaces.atlas',
  composition: 'keyboardShortcutsSection.surfaces.workflows',
  review: 'keyboardShortcutsSection.surfaces.review',
  settings: 'keyboardShortcutsSection.surfaces.settings',
}
const EVERYWHERE_LABEL_KEY = 'keyboardShortcutsSection.surfaces.everywhere'

// Fixed display order (Decision 1's own list: "Everywhere, Atlas,
// Workflows (composition), Review") -- any OTHER surface a command
// declares (settings.search's own 'settings' scope, or a future one)
// is appended after, sorted by its own surface key, so a new surface is
// never silently dropped from the editor.
const PRIMARY_ORDER: SurfaceKey[] = ['everywhere', 'atlas', 'composition', 'review']

function surfaceKeyFor(command: Command): SurfaceKey {
  // No command declares more than one surface today (every
  // shared/*Commands.ts entry's own `surface` array is a singleton) --
  // the first entry is the group a multi-surface command would land in
  // if one is ever added.
  return command.surface?.[0] ?? 'everywhere'
}

function labelKeyFor(key: SurfaceKey): string {
  if (key === 'everywhere') return EVERYWHERE_LABEL_KEY
  return SURFACE_LABEL_KEY[key] ?? key
}

function isBound(command: Command, overrides: Record<string, KeyCombo>): boolean {
  return effectiveBinding(command, overrides) !== null || (command.extraBindings?.length ?? 0) > 0
}

function isCustomised(command: Command, overrides: Record<string, KeyCombo>): boolean {
  return command.id in overrides
}

function byLabel(a: Command, b: Command): number {
  return commandLabel(a).localeCompare(commandLabel(b))
}

// groupCommandsBySurface: pure, given whatever command SET the caller
// already narrowed (a search/facet filter, or the full rebindable
// list) -- never re-derives the search/facet decision itself, so a
// facet that hides unbound rows entirely does so by narrowing the
// input, not by a second flag here. A surface with nothing left after
// narrowing is omitted, never rendered as an empty group.
export function groupCommandsBySurface(commands: Command[], overrides: Record<string, KeyCombo>): SurfaceGroup[] {
  const bySurface = new Map<SurfaceKey, { bound: Command[]; unbound: Command[] }>()
  for (const command of commands) {
    const key = surfaceKeyFor(command)
    const bucket = bySurface.get(key) ?? { bound: [], unbound: [] }
    if (isBound(command, overrides)) bucket.bound.push(command)
    else bucket.unbound.push(command)
    bySurface.set(key, bucket)
  }

  const keys = [...bySurface.keys()]
  const ordered = [
    ...PRIMARY_ORDER.filter((k) => bySurface.has(k)),
    ...keys.filter((k) => !PRIMARY_ORDER.includes(k)).sort((a, b) => String(a).localeCompare(String(b))),
  ]

  return ordered.map((surface) => {
    const bucket = bySurface.get(surface)!
    const bound = [...bucket.bound].sort(byLabel)
    return {
      surface,
      label: labelKeyFor(surface),
      bound,
      unbound: [...bucket.unbound].sort(byLabel),
      customisedCount: bound.filter((c) => isCustomised(c, overrides)).length,
    }
  })
}

export type ShortcutFacet = 'all' | 'bound' | 'unbound' | 'customised'

export interface FacetCounts {
  all: number
  bound: number
  unbound: number
  customised: number
}

// countCommandsByFacet: counts over the SEARCH-narrowed set (never the
// currently-active facet's own narrowing) -- so switching facets never
// changes what count another facet's own tab shows, the standard
// faceted-search contract (GitHub's own issue-list facets).
export function countCommandsByFacet(commands: Command[], overrides: Record<string, KeyCombo>): FacetCounts {
  let bound = 0
  let customised = 0
  for (const command of commands) {
    if (isBound(command, overrides)) bound++
    if (isCustomised(command, overrides)) customised++
  }
  return { all: commands.length, bound, unbound: commands.length - bound, customised }
}

// filterCommandsByFacet narrows an already search-matched set down to
// the active facet's own membership -- 'all' is a no-op copy, so a
// caller can always render off this function's result uniformly.
export function filterCommandsByFacet(commands: Command[], overrides: Record<string, KeyCombo>, facet: ShortcutFacet): Command[] {
  switch (facet) {
    case 'bound':
      return commands.filter((c) => isBound(c, overrides))
    case 'unbound':
      return commands.filter((c) => !isBound(c, overrides))
    case 'customised':
      return commands.filter((c) => isCustomised(c, overrides))
    default:
      return commands
  }
}

// filterCommandsByChord: the "find by shortcut" predicate (JetBrains
// Keymap's own find-actions-by-shortcut) -- a command matches on its
// effective binding OR any read-only extraBinding (shared/commandTypes.ts),
// so pressing an alias combo finds the command it aliases too. Every
// match is necessarily bound (a chord can never equal a null binding),
// so this never needs its own facet.
export function filterCommandsByChord(commands: Command[], overrides: Record<string, KeyCombo>, combo: KeyCombo): Command[] {
  const want = comboKey(combo.mods, combo.key)
  return commands.filter((c) => {
    const binding = effectiveBinding(c, overrides)
    if (binding && comboKey(binding.mods, binding.key) === want) return true
    return (c.extraBindings ?? []).some((b) => comboKey(b.mods, b.key) === want)
  })
}
