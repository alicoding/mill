import type { Icon } from '@primer/octicons-react'
import { copy } from '../shared/copy'
import type { DisplayDensity } from '../shared/density'
import type { EditRouteDecl, ObjectSource } from '../atlas/objectSeams'
import type { AtlasToolShape } from '../atlas/atlasTools'
import type { AtlasNounGroup, ExtensionSettingDecl, ToolLessNounExtension } from '../atlas/atlasNounRegistry'

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
  // The tray/palette verb phrase ("Add an image"), kept alongside the
  // noun title so the detail pane's "What it adds" can name the
  // command this noun contributes. Absent for a tool-less noun, which
  // has no creation command at all.
  commandLabel?: string
  description?: string
  group: AtlasNounGroup
  source?: ObjectSource
  editRoute?: EditRouteDecl
  capabilities?: readonly string[]
  disableScopeNote?: string
  settings?: readonly ExtensionSettingDecl[]
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
    label: copy(tool.nounName),
    commandLabel: copy(tool.label),
    description: tool.description === undefined ? undefined : copy(tool.description),
    group: tool.group,
    source: tool.content?.source,
    editRoute: tool.content?.editRoute,
    capabilities: tool.capabilities,
    settings: tool.settings,
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
    label: copy(extension.label),
    description: copy(extension.description),
    group: extension.group,
    source: content.source,
    editRoute: content.editRoute,
    capabilities: extension.capabilities,
    disableScopeNote: copy(extension.disableScopeNote),
    settings: extension.settings,
  }
}

// groupLabel -- AtlasNounGroup's own clusters, restated as short chip
// text a user would recognize (never the dock's own internal cluster
// name). Used only by the expanded row's own chip list
// (ExtensionRow.tsx) -- the collapsed row's meta line reads
// groupSectionLabel below instead, since the section heading above
// every row already says this once (goal 0237 S3's review rider:
// repeating it a second time on every row read as noise).
export function groupLabel(group: AtlasNounGroup): string {
  switch (group) {
    case 'objects': return copy('views:settings.extensions.meta.groupObjects')
    case 'media': return copy('views:settings.extensions.meta.groupMedia')
    case 'annotate': return copy('views:settings.extensions.meta.groupAnnotate')
    case 'embed': return copy('views:settings.extensions.meta.groupEmbed')
  }
}

// groupSectionLabel -- the same clusters, restated as the SECTION
// heading text -- plural where groupLabel's per-row chip stays singular
// ("Object"), since a heading names a collection and a chip names one
// row's own attribute.
export function groupSectionLabel(group: AtlasNounGroup): string {
  switch (group) {
    case 'objects': return copy('views:settings.extensions.meta.sectionObjects')
    case 'media': return copy('views:settings.extensions.meta.sectionMedia')
    case 'annotate': return copy('views:settings.extensions.meta.sectionAnnotate')
    case 'embed': return copy('views:settings.extensions.meta.sectionEmbed')
  }
}

// sourceLabel -- ObjectSource's own three kinds. null for a tool with
// no ObjectSource declared at all (card/note/area: no external
// artifact, nothing this chip could honestly claim).
export function sourceLabel(source: ObjectSource | undefined): string | null {
  if (!source) return null
  switch (source.kind) {
    case 'board-local': return copy('views:settings.extensions.meta.sourceBoardLocal')
    case 'file': return copy('views:settings.extensions.meta.sourceFile')
    case 'url': return copy('views:settings.extensions.meta.sourceUrl')
    case 'provider': return copy('views:settings.extensions.meta.sourceProvider')
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
  if (typeof decl === 'function') return copy('views:settings.extensions.meta.editResolved')
  switch (decl.kind) {
    case 'external-app': return copy('views:settings.extensions.meta.editExternalApp')
    case 'embedded-engine': return copy('views:settings.extensions.meta.editEmbedded', { engine: decl.engine })
    case 'inline': return copy('views:settings.extensions.meta.editInline')
    case 'none': return null
  }
}

// descriptionLabel -- AtlasToolShape.description's own display text
// (goal 0211's plugin-manager UX slice), falling back to the tool's own
// label for a noun that hasn't been given a description yet, so the
// Extensions section's disclosure always shows something rather than an
// empty line.
export function descriptionLabel(tool: { description?: string; label: string }): string {
  return copy(tool.description ?? tool.label)
}

// reachLabel -- ADR-0047's declared-capability set, rendered honestly:
// no current noun declares any capabilities, so this reads "Reaches
// nothing outside Mill." for every one of them today. Once a noun
// declares real capabilities, this lists them verbatim -- the line
// derives from the registry, it is never hardcoded per tool.
export function reachLabel(capabilities: readonly string[] | undefined): string {
  if (!capabilities || capabilities.length === 0) return copy('views:settings.extensions.meta.reachNothing')
  return copy('views:settings.extensions.meta.reachList', { list: capabilities.join(', ') })
}

// versionLabel -- every extension today is compiled into Mill itself
// (goal 0211's tier model), so its own "version" is simply the app's
// own build version rather than a per-extension one.
export function versionLabel(appVersion: string): string {
  return copy('views:settings.extensions.meta.version', { version: appVersion })
}

// Row geometry (goal 0321): the Extensions list is a scan surface, so
// its rows follow display density directly rather than through the
// shared card padding. Driven from JS (an inline padding) rather than
// a CSS var so the mapping has ONE source a unit test can pin --
// the same props-not-styles shape the adopted table grid already uses
// for its own row heights.
//
// ROW_CONTENT_HEIGHT is the 14px title line's own box; the floor keeps
// a Compact row tall enough for the 16px leading icon it carries,
// which the raw Compact token (2px) is not.
const ROW_CONTENT_HEIGHT = 20
const COMPACT_PAD_Y = 6
const COMFORTABLE_PAD_Y = 12

export function extensionRowPadY(density: DisplayDensity): number {
  return density === 'compact' ? COMPACT_PAD_Y : COMFORTABLE_PAD_Y
}

export function extensionRowHeight(density: DisplayDensity): number {
  return extensionRowPadY(density) * 2 + ROW_CONTENT_HEIGHT
}
