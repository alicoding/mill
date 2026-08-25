import type { Icon } from '@primer/octicons-react'

// The style surface's closed property-type vocabulary (goal 0209,
// standing rule from docs/goals/0211-extension-tiers.md: a NEW registry
// field is designed as if third-party-declared, and its vocabulary
// documented where an outsider could read it -- see
// userdocs/reference/canvas-styling.md). Exactly four shapes; a fifth
// property TYPE (not a fifth per-noun FIELD -- that costs a noun one
// declaration line, see e.g. shapeTool.ts's own SHAPE_STYLE_FIELDS)
// means widening this union and AtlasStylePanel.tsx's own render
// dispatch, deliberately the more expensive of the two costs. This
// module knows nothing about which noun uses which type -- 'shape' and
// 'pencil' never appear here -- every option list lives on the FIELD
// descriptor a noun's own tools/<id>Tool.ts builds, never inlined here.
export type AtlasStyleValue = string | number

interface AtlasStyleFieldBase {
  // The BoardObject.Payload / ephemeral-style-store key this field
  // reads and writes (e.g. 'stroke', 'fill', 'shapeType').
  key: string
  // testid prefix the generic panel builds each option's own
  // data-testid from (`${testidPrefix}-${optionKey}`) -- carries the
  // noun's own id already baked in by whoever built the field (e.g.
  // 'atlas-shape-stroke'), so this module never needs to know it.
  testidPrefix: string
  // i18n key for this field's own row `aria-label` (a `role="group"` per
  // field, matching what AtlasShapeStylePicker/AtlasPencilStylePicker
  // already rendered per row before this migration).
  groupLabelKey: string
}

// A swatch picker from a fixed set of hex colours -- pencil's own
// stroke colour, shape's own stroke colour.
export interface AtlasColorField extends AtlasStyleFieldBase {
  type: 'color'
  options: readonly string[]
  default: string
}

// The same swatch picker plus an explicit "none" option, rendered
// first, that is this field's own default -- shape's own fill.
export interface AtlasColorOrNoneField extends AtlasStyleFieldBase {
  type: 'color-or-none'
  options: readonly string[]
  // i18n key for the "none" option's own aria-label.
  noneLabelKey: string
  default: 'none'
}

// A numeric picker rendered as either a height-scaled line or a
// diameter-scaled dot -- shape's own stroke width (line), pencil's own
// size (dot). `render` is a visual discriminant only; the VALUE stored
// is always a plain number either way.
export interface AtlasStrokeWidthField extends AtlasStyleFieldBase {
  type: 'stroke-width'
  render: 'line' | 'dot'
  options: readonly number[]
  // i18n key for each option's own aria-label, interpolated with
  // `{ width }` when render is 'line' and `{ size }` when render is
  // 'dot' -- AtlasStylePanel.tsx picks the interpolation var off
  // `render` so this stays one key per field, matching the two
  // existing keys (shapeStyle.widthOption / pencilStyle.sizeOption)
  // unchanged.
  optionLabelKey: string
  default: number
}

// An icon-button picker from a small fixed set of named options --
// shape's own shapeType (rectangle/ellipse/arrow).
export interface AtlasShapeKindOption {
  value: string
  Icon: Icon
  labelKey: string
}

export interface AtlasShapeKindField extends AtlasStyleFieldBase {
  type: 'shape-kind'
  options: readonly AtlasShapeKindOption[]
  default: string
}

// The closed union AtlasStylePanel.tsx dispatches on and
// atlasNounRegistry.ts's own `styleFields` requires every noun to
// declare (an empty array is the honest answer for a noun with no
// style surface at all).
export type AtlasStyleField = AtlasColorField | AtlasColorOrNoneField | AtlasStrokeWidthField | AtlasShapeKindField
