import type { Icon } from '@primer/octicons-react'
import type { EditRouteDecl, ObjectSource } from '../atlas/objectSeams'
import type { AtlasToolShape } from '../atlas/atlasTools'
import type { ToolLessNounExtension } from '../atlas/atlasNounRegistry'

// Pure enum -> user-vocabulary mapping for the Extensions section
// (Settings > Extensions). Kept in its own file, apart from
// ExtensionsSection.tsx, purely so these three functions stay
// independently Vitest-testable without mounting the section
// component (.claude/rules/testing.md's "pure-function bug -> a
// Vitest unit test" layering) -- every other Settings section already
// keeps its own pure formatter/description logic inline since none of
// them branch on an enum this way.

// ExtensionRowSource -- the ONE row shape ExtensionRow.tsx renders,
// normalized from either a tray tool (AtlasToolShape) or a tool-less
// noun (ToolLessNounExtension) by the two builders below -- so the row
// component itself never branches on which kind of noun it's showing.
// group/description/capabilities/disableScopeNote stay optional: a
// tool-less noun has no tray cluster to report (there is no `group`
// chip for a noun with no tray at all) and only IT ever sets
// disableScopeNote, since only it needs to say its toggle's scope
// differs from a tray tool's.
export interface ExtensionRowSource {
  id: string
  icon: Icon
  label: string
  description?: string
  group?: AtlasToolShape['group']
  source?: ObjectSource
  editRoute?: EditRouteDecl
  capabilities?: readonly string[]
  disableScopeNote?: string
}

// toolRowSource -- every ATLAS_TOOLS member becomes a row exactly as it
// already did before goal 0237 S3's rider (ExtensionsSection.tsx used
// to read AtlasToolShape fields directly); this is that same read,
// pulled out so it composes with toolLessRowSource below into one list.
export function toolRowSource(tool: AtlasToolShape): ExtensionRowSource {
  return {
    id: tool.id,
    icon: tool.icon,
    label: tool.label,
    description: tool.description,
    group: tool.group,
    source: tool.content?.source,
    editRoute: tool.content?.editRoute,
    capabilities: tool.capabilities,
  }
}

// toolLessRowSource -- a tool-less noun's own row (goal 0237 S3 rider):
// icon/label/description/disableScopeNote come from its declared
// `extension` (atlasNounRegistry.ts's ExtensionRowMeta), source/
// editRoute from the same content declaration a tray tool's row reads,
// and no `group` -- there is no tray cluster to report honestly.
export function toolLessRowSource({ kind, content, extension }: ToolLessNounExtension): ExtensionRowSource {
  return {
    id: kind,
    icon: extension.icon,
    label: extension.label,
    description: extension.description,
    source: content.source,
    editRoute: content.editRoute,
    capabilities: extension.capabilities,
    disableScopeNote: extension.disableScopeNote,
  }
}

// groupLabel -- AtlasToolShape.group's own three clusters, restated as
// short chip text a user would recognize (never the tray's own
// internal cluster name).
export function groupLabel(group: AtlasToolShape['group']): string {
  switch (group) {
    case 'knowledge': return 'Knowledge'
    case 'file': return 'File'
    case 'annotate': return 'Drawing'
  }
}

// sourceLabel -- ObjectSource's own three kinds. null for a tool with
// no ObjectSource declared at all (card/note/area: no external
// artifact, nothing this chip could honestly claim).
export function sourceLabel(source: ObjectSource | undefined): string | null {
  if (!source) return null
  switch (source.kind) {
    case 'board-local': return 'Stored on the board'
    case 'file': return 'Backed by a file'
    case 'url': return 'Points at a web address'
    case 'provider': return 'Live view of a List'
  }
}

// editRouteLabel -- EditRouteDecl's own route kinds. null for 'none'
// (nothing to say -- there is no separate edit door) and for a tool
// with no editRoute declared at all. A per-object RESOLVER (diagram's
// own shape, ADR-0046) has no single static phrase to show for a
// TOOL-level row, so it falls back to one honest generic phrase rather
// than guessing a specific engine.
export function editRouteLabel(decl: EditRouteDecl | undefined): string | null {
  if (!decl) return null
  if (typeof decl === 'function') return 'Edit method depends on the file'
  switch (decl.kind) {
    case 'external-app': return 'Opens in your default app'
    case 'embedded-engine': return `Edits in ${decl.engine}`
    case 'inline': return 'Edits in place'
    case 'none': return null
  }
}

// descriptionLabel -- AtlasToolShape.description's own display text
// (goal 0211's plugin-manager UX slice), falling back to the tool's own
// label for a noun that hasn't been given a description yet, so the
// Extensions section's disclosure always shows something rather than an
// empty line.
export function descriptionLabel(tool: { description?: string; label: string }): string {
  return tool.description ?? tool.label
}

// reachLabel -- ADR-0047's declared-capability set, rendered honestly:
// no current noun declares any capabilities, so this reads "Reaches
// nothing outside Mill." for every one of them today. Once a noun
// declares real capabilities, this lists them verbatim -- the line
// derives from the registry, it is never hardcoded per tool.
export function reachLabel(capabilities: readonly string[] | undefined): string {
  if (!capabilities || capabilities.length === 0) return 'Reaches nothing outside Mill.'
  return `Reaches ${capabilities.join(', ')}.`
}

// versionLabel -- every extension today is compiled into Mill itself
// (goal 0211's tier model), so its own "version" is simply the app's
// own build version rather than a per-extension one.
export function versionLabel(appVersion: string): string {
  return `Ships with Mill v${appVersion}`
}
