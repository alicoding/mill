import { Type as FieldType } from '../../bindings/github.com/alicoding/mill/internal/domain/typedfield/models'

// The five field types the card surface actually renders
// (AtlasFieldsForm) -- offering more here would author fields the
// page can only show as plain text. Shared by AtlasKindEditor.tsx and
// AtlasKindProposal.tsx (goal 0172 S2) so both offer this exact same
// set for a field's own Type select, rather than two hand-maintained
// lists.
export const FIELD_TYPES: { value: FieldType; labelKey: string }[] = [
  { value: FieldType.TypeText, labelKey: 'kinds.fieldTypeText' },
  { value: FieldType.TypeNumber, labelKey: 'kinds.fieldTypeNumber' },
  { value: FieldType.TypeBoolean, labelKey: 'kinds.fieldTypeBoolean' },
  { value: FieldType.TypeOptions, labelKey: 'kinds.fieldTypeOptions' },
  { value: FieldType.TypeCardRef, labelKey: 'kinds.fieldTypeCardRef' },
]
