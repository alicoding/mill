import type { Icon } from '@primer/octicons-react'
import type { EditRouteDecl, ObjectSource } from '../atlas/objectSeams'
import type { AtlasToolShape } from '../atlas/atlasTools'
import type { AtlasNounGroup, ToolLessNounExtension } from '../atlas/atlasNounRegistry'

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
// group is REQUIRED (goal 0237 S3's Extensions-list review rider):
// every row, tool-bearing or not, now belongs to one of the three
// Settings > Extensions sections (ExtensionsSection.tsx), so a row
// with no honest group would silently vanish from every one of them.
// description/capabilities/disableScopeNote stay optional: only a
// tool-less noun ever sets disableScopeNote, since only it needs to
// say its toggle's scope differs from a tray tool's.
export interface ExtensionRowSource {
  id: string
  icon: Icon
  label: string
  description?: string
  group: AtlasNounGroup
  source?: ObjectSource
  editRoute?: EditRouteDecl
  capabilities?: readonly string[]
  disableScopeNote?: string
}

// toolRowSource -- every ATLAS_TOOLS member becomes a row exactly as it
// already did before goal 0237 S3's rider (ExtensionsSection.tsx used
// to read AtlasToolShape fields directly); this is that same read,
// pulled out so it composes with toolLessRowSource below into one list.
// `label` reads nounName, not the tool's own command-verb `label` (goal
// 0237 S3's Extensions-list review rider) -- the row title is what a
// user calls this thing ("Card"), never what clicking it does ("Add a
// card").
export function toolRowSource(tool: AtlasToolShape): ExtensionRowSource {
  return {
    id: tool.id,
    icon: tool.icon,
    label: tool.nounName,
    description: tool.description,
    group: tool.group,
    source: tool.content?.source,
    editRoute: tool.content?.editRoute,
    capabilities: tool.capabilities,
  }
}

// toolLessRowSource -- a tool-less noun's own row (goal 0237 S3 rider):
// icon/label/description/disableScopeNote/group come from its declared
// `extension` (atlasNounRegistry.ts's ExtensionRowMeta) -- `label` is
// already the noun itself here (diagram/sheet have no separate command
// verb to disambiguate from) -- source/editRoute come from the same
// content declaration a tray tool's row reads.
export function toolLessRowSource({ kind, content, extension }: ToolLessNounExtension): ExtensionRowSource {
  return {
    id: kind,
    icon: extension.icon,
    label: extension.label,
    description: extension.description,
    group: extension.group,
    source: content.source,
    editRoute: content.editRoute,
    capabilities: extension.capabilities,
    disableScopeNote: extension.disableScopeNote,
  }
}

// groupLabel -- AtlasNounGroup's own three clusters, restated as short
// chip text a user would recognize (never the tray's own internal
// cluster name). Used only by the expanded row's own chip list
// (ExtensionRow.tsx) -- the collapsed row's meta line reads
// groupSectionLabel below instead, since the section heading above
// every row already says this once (goal 0237 S3's review rider:
// repeating it a second time on every row read as noise).
export function groupLabel(group: AtlasNounGroup): string {
  switch (group) {
    case 'knowledge': return 'Knowledge'
    case 'file': return 'File'
    case 'annotate': return 'Drawing'
  }
}

// groupSectionLabel -- the same three clusters, restated as the
// SECTION heading text (goal 0237 S3's review rider: "Knowledge",
// "Files", "Drawing") -- plural where groupLabel's per-row chip stays
// singular ("File"), since a heading names a collection and a chip
// names one row's own attribute.
export function groupSectionLabel(group: AtlasNounGroup): string {
  switch (group) {
    case 'knowledge': return 'Knowledge'
    case 'file': return 'Files'
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
