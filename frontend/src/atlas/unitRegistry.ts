import type { ComponentType } from 'react'
import type { Card } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'

// The board-unit renderer registry (ADR-0043, goal 0133 slice 1): a
// card's content type -- a projection ref, a MirrorPath extension, or
// a bare Source -- resolves to exactly one registered UnitRenderer,
// the way a NodeType self-registers (architecture.md's core/
// composition boundary, one level down into board content). Adding a
// new content type is one registration + one lazy render module; the
// card page and board node components stay untouched.
//
// This module absorbs atlasCardPresentation.ts's old deriveFileTag
// chain rather than duplicating it: deriveFileTag now delegates to
// resolveUnit + the resolved unit's own tag() below, so there is
// exactly one place that decides "what type is this card."

export type FileTagLabel = 'MD' | 'IMG' | 'PDF' | 'URL' | 'MMD' | 'DRAWIO'
export type FileTagColor = 'success' | 'attention' | 'danger'

export interface FileTag {
  label: FileTagLabel
  color: FileTagColor
}

// The subset of a Card a unit needs to detect its own type and derive
// a face/header tag from -- narrower than the full Card so a caller
// (a test fixture, a partial card during creation) never has to
// fabricate fields it doesn't have. ProjectionListID is optional on
// Card itself, so an object that omits it entirely (every existing
// deriveFileTag caller/test) still satisfies this type: it simply
// reads as "not a projection," never a type error.
export type DetectableCard = Pick<Card, 'Source' | 'MirrorPath' | 'ProjectionListID'>

// A unit's actual render component takes the full card it's rendering
// for -- reading whichever fields it needs (cardID, MirrorPath,
// ProjectionDensity, ...) itself, so the registry's own plumbing never
// has to know each renderer's specific prop shape.
export interface UnitRenderProps {
  card: Card
}

export type UnitComponent = ComponentType<UnitRenderProps>

// A renderer is loaded lazily (the CodeEditor/codeEditorCore
// precedent, ADR-0043 §4): the registry stores a LOADER, not the
// component itself, so importing unitRegistry.ts never pulls a
// renderer's own weight into the eagerly-loaded main bundle. Slice 1's
// renderers are all lightweight, but the mechanism is what slices 2-4
// (mermaid, drawio) need already proven.
export type UnitComponentLoader = () => Promise<UnitComponent>

export interface UnitExporter {
  format: string
  label: string
  serialize: (card: Card) => Promise<{ bytes: BlobPart; filename: string }>
}

export interface UnitRenderer {
  id: string
  // A pure predicate over the card's own facts -- no I/O, mirroring
  // atlas/mirror.go's ClassifyMirrorKind on the Go side (an extension-
  // only decision there too).
  detect: (card: DetectableCard) => boolean
  // The face/header file-tag this unit contributes (deriveFileTag's
  // old per-branch labels), or null for a unit that carries no tag
  // (the table projection shows its own tag-alternative -- the
  // density-toggle chip -- rather than the file-tag chip).
  tag: (card: DetectableCard) => FileTag | null
  render: {
    // The full-detail presentation (the card page's Contents column).
    Page?: UnitComponentLoader
    // The compact, board-node-embeddable presentation. Optional: a
    // unit with no compact face yet (mirror content today) simply
    // isn't shown inline on the board face, same as before this
    // registry existed.
    Face?: UnitComponentLoader
  }
  // Declared, contextual Export-as formats (ADR-0043 §3) -- empty in
  // slice 1 for every unit; populated as slices 3+ land their
  // serializers. An empty array is honest ("no export yet"), never a
  // placeholder entry.
  exporters: UnitExporter[]
}

// A per-loader cached promise so mounting the same unit's renderer for
// N cards on one board fetches its chunk exactly once (the same shape
// codeEditorCore.ts's own loadCore() uses).
export function cachedLoader(load: () => Promise<UnitComponent>): UnitComponentLoader {
  let promise: Promise<UnitComponent> | null = null
  return () => {
    promise ??= load()
    return promise
  }
}

// extensionOf parses a MirrorPath's lowercase extension -- the one
// piece of atlasCardPresentation.ts's old deriveFileTag chain every
// unit's own detect()/tag() still needs, so it lives here rather than
// being re-derived per unit file.
export function extensionOf(path: string): string {
  const slash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  const dot = path.lastIndexOf('.')
  if (dot <= slash) return ''
  return path.slice(dot).toLowerCase()
}

// resolveUnit walks units (assembled in priority order by
// atlasUnits.ts, the commands.ts-shaped assembly point) and returns
// the first whose detect() matches -- a projection ref beats an
// extension beats a bare Source (ADR-0043 §1), because the table-
// projection unit is assembled first, then the extension-based mirror
// units, then the icon-card fallback (detect: any MirrorPath or
// Source at all) last. A card with none of the three -- a plain note
// -- resolves to null, same as "no unit claims this" today.
export function resolveUnit(units: UnitRenderer[], card: DetectableCard): UnitRenderer | null {
  for (const unit of units) {
    if (unit.detect(card)) return unit
  }
  return null
}
