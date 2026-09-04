import type { Icon } from '@primer/octicons-react'
import { copy } from '../shared/copy'
import { FileIcon } from '@primer/octicons-react'
import type { Kind } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import type { ContentEntry } from '../../bindings/github.com/alicoding/mill/internal/services/atlassvc/models'
import { orderedRegisteredTools } from './atlasNounRegistry'
import { toolLessNounExtensions } from './atlasBoardObjectContent'

// The Contents dialog's pure half (docs/goals/0279): group the bound
// content index (goal 0278's ListContents) by kind in a fixed order --
// cards, notes, then every object kind in registry order -- filter by
// title, and resolve each kind's noun + icon from the registries so a
// newly registered Kind (a plugin's) lists under its own heading with
// its own icon and no per-kind branch anywhere.

export interface ContentsGroup {
  kind: string
  label: string
  Icon: Icon
  entries: ContentEntry[]
}

export interface KindPresentation {
  label: string
  Icon: Icon
}

// kindPresentation -- the noun and icon for one content kind: the
// card/note identities for the two kernel kinds, a tray tool's own
// nounName/icon (built-in or plugin, matched on the object Kind it
// places), a tool-less noun's extension row meta, else a generic file.
export function kindPresentation(kind: string): KindPresentation {
  // card and note are tray tools too, so the same lookup names them;
  // the fallbacks only matter in a test without the registry loaded.
  const tool = orderedRegisteredTools().find((t) => t.id === kind || t.boardObjectKind === kind)
  // A plugin tool declares a command label ("Draw with the pencil"),
  // not a noun; its object kind title-cased is the honest heading.
  if (tool) return { label: 'thirdParty' in tool && tool.thirdParty ? titleCase(kind) : copy(tool.nounName), Icon: tool.icon }
  const toolLess = toolLessNounExtensions().find((e) => e.kind === kind)
  if (toolLess) return { label: toolLess.extension.label, Icon: toolLess.extension.icon }
  return { label: titleCase(kind), Icon: FileIcon }
}

function titleCase(kind: string): string {
  return kind.charAt(0).toUpperCase() + kind.slice(1).replace(/-/g, ' ')
}

function kindOrder(kind: string): number {
  if (kind === 'card') return 0
  if (kind === 'note') return 1
  const tools = orderedRegisteredTools()
  const i = tools.findIndex((t) => t.boardObjectKind === kind || t.id === kind)
  if (i >= 0) return 2 + i
  const j = toolLessNounExtensions().findIndex((e) => e.kind === kind)
  return j >= 0 ? 1000 + j : 2000
}

// groupContents -- the dialog's rows: entries whose title contains the
// (trimmed, case-insensitive) filter, grouped and ordered as above,
// titles ascending within a group; empty groups are omitted.
export function groupContents(entries: ContentEntry[], filter: string): ContentsGroup[] {
  const q = filter.trim().toLowerCase()
  const byKind = new Map<string, ContentEntry[]>()
  for (const e of entries) {
    if (q && !e.Title.toLowerCase().includes(q)) continue
    const list = byKind.get(e.Kind) ?? []
    list.push(e)
    byKind.set(e.Kind, list)
  }
  return [...byKind.entries()]
    .sort(([a], [b]) => kindOrder(a) - kindOrder(b) || a.localeCompare(b))
    .map(([kind, list]) => ({
      kind,
      ...kindPresentation(kind),
      entries: [...list].sort((a, b) => a.Title.localeCompare(b.Title) || a.ID.localeCompare(b.ID)),
    }))
}

// kindLabelFor -- a card's own Kind label for its row's muted kicker.
export function kindLabelFor(entry: ContentEntry, kinds: Kind[]): string | undefined {
  if (entry.Kind !== 'card') return undefined
  return kinds.find((k) => k.ID === entry.Subkind)?.Label
}
