import type { EditRouteDecl, ObjectSource } from '../atlas/objectSeams'
import type { AtlasToolShape } from '../atlas/atlasTools'

// Pure enum -> user-vocabulary mapping for the Extensions section
// (Settings > Extensions). Kept in its own file, apart from
// ExtensionsSection.tsx, purely so these three functions stay
// independently Vitest-testable without mounting the section
// component (.claude/rules/testing.md's "pure-function bug -> a
// Vitest unit test" layering) -- every other Settings section already
// keeps its own pure formatter/description logic inline since none of
// them branch on an enum this way.

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
