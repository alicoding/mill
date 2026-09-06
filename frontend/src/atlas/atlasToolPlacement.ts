import type { AtlasNounGroup, AtlasToolShape } from './atlasNounRegistry'

// Where every registered tool renders on the board's creation dock
// (goal 0355). The dock's visible buttons are FIXED -- four object
// slots, one Media slot, one Annotate slot, one More slot -- and never
// grow per installed tool, so this file answers one question for the
// whole surface: given the registry, which tools sit in which slot and
// which are reachable only through the More panel's search. Pure (no
// React, no store reads) so AtlasCreationTray.tsx never re-derives a
// placement rule inline and the whole table is unit-testable.

// The four object slots, in the order the dock renders them. Their
// letter chips (C/N/A/T) are the reason this list is fixed rather than
// derived from group 'objects': a plugin declaring 'objects' would
// otherwise shift or displace a chip a person has already learned, so
// it lands in the More panel's Objects section instead.
export const DOCK_OBJECT_TOOL_IDS = ['card', 'note', 'area', 'table'] as const

// Which slot the dock shows a tool in. 'panel' means the tool has no
// button of its own and is found by name in the More panel -- never
// that it is unavailable.
export type AtlasDockSlot = 'objects' | 'media' | 'annotate' | 'panel'

// The More panel's category chips, in render order. 'all' is not a
// group: it is the unfiltered default.
export const MORE_PANEL_CATEGORIES = ['all', 'objects', 'media', 'annotate', 'embed'] as const
export type AtlasMorePanelCategory = (typeof MORE_PANEL_CATEGORIES)[number]

export interface AtlasDockPlacement {
  // The four object buttons, in DOCK_OBJECT_TOOL_IDS order, minus any
  // whose tool is disabled in Settings > Extensions (a disabled tool
  // has no button at all, never a dimmed one).
  objects: AtlasToolShape[]
  // Every tool the Media flyout lists. The flyout ALSO offers "From
  // file…", which is not a tool at all, so the slot renders even when
  // this holds a single entry.
  media: AtlasToolShape[]
  // Every tool the Annotate flyout lists; an empty array renders no
  // slot, since a flyout with nothing to disclose is a dead end.
  annotate: AtlasToolShape[]
  // Every registered tool, in registry order -- what the More panel
  // searches. Includes the ones with a dock button: a person who
  // reaches for search should find Card there too.
  panel: AtlasToolShape[]
}

// dockSlotFor -- the single mapping from a tool's declared group to the
// slot its button lives in. Exported for its unit test and for the
// More panel's own per-row category.
export function dockSlotFor(tool: Pick<AtlasToolShape, 'id' | 'group'>): AtlasDockSlot {
  if ((DOCK_OBJECT_TOOL_IDS as readonly string[]).includes(tool.id)) return 'objects'
  if (tool.group === 'media') return 'media'
  if (tool.group === 'annotate') return 'annotate'
  return 'panel'
}

// placeDockTools -- the dock's whole layout in one call. `tools` is the
// already-enablement-filtered registry snapshot; order within a flyout
// follows the registry, so a built-in leads and plugin faces follow.
export function placeDockTools(tools: readonly AtlasToolShape[]): AtlasDockPlacement {
  const byId = new Map(tools.map((tool) => [tool.id as string, tool]))
  return {
    objects: DOCK_OBJECT_TOOL_IDS.map((id) => byId.get(id)).filter((tool): tool is AtlasToolShape => tool !== undefined),
    media: tools.filter((tool) => dockSlotFor(tool) === 'media'),
    annotate: tools.filter((tool) => dockSlotFor(tool) === 'annotate'),
    panel: [...tools],
  }
}

// matchesCategory -- one More panel chip's filter. 'all' matches every
// tool; every other chip matches the group of the same name, so a
// plugin face that declares nothing lands under Extensions.
export function matchesCategory(tool: Pick<AtlasToolShape, 'group'>, category: AtlasMorePanelCategory): boolean {
  return category === 'all' || tool.group === (category as AtlasNounGroup)
}

// matchesToolQuery -- the More panel's search. Case-insensitive
// substring over the two things a person types: the tool's own name and
// the plugin it came from. Trimmed, so a trailing space from a paste
// never empties the list.
export function matchesToolQuery(fields: { label: string; nounName: string; pluginId?: string }, query: string): boolean {
  const needle = query.trim().toLowerCase()
  if (needle === '') return true
  return [fields.label, fields.nounName, fields.pluginId ?? ''].some((field) => field.toLowerCase().includes(needle))
}

// How many recents the panel keeps. Five is the row it renders; a
// longer memory would scroll, which defeats "the thing I just used".
export const MAX_RECENT_TOOLS = 5

// pushRecentTool -- most-recent-first, de-duplicated, capped. Pure so
// the store below and its test share one rule.
export function pushRecentTool(recents: readonly string[], id: string): string[] {
  return [id, ...recents.filter((entry) => entry !== id)].slice(0, MAX_RECENT_TOOLS)
}

// The recents list is per device, not per board or per account: it
// answers "what did I reach for on THIS machine", so it lives in the
// browser's own storage rather than Mill's synced state. A storage
// read/write that throws (a private window, storage disabled) leaves
// the panel working with no recents rather than failing to render.
const RECENT_TOOLS_STORAGE_KEY = 'mill.atlas.recentTools'

export function readRecentTools(): string[] {
  try {
    const raw = window.localStorage.getItem(RECENT_TOOLS_STORAGE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((entry): entry is string => typeof entry === 'string').slice(0, MAX_RECENT_TOOLS)
  } catch {
    return []
  }
}

export function writeRecentTools(recents: readonly string[]): void {
  try {
    window.localStorage.setItem(RECENT_TOOLS_STORAGE_KEY, JSON.stringify(recents))
  } catch {
    // Storage unavailable: recents simply don't persist across
    // reloads. Never a user-visible failure -- nothing was asked for.
  }
}
