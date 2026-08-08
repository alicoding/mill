import { z } from 'zod'
import { fake, setFaker } from 'zod-schema-faker/v4'
import { faker } from '@faker-js/faker'
import { ConfigFieldType } from '../../bindings/github.com/alicoding/mill/internal/domain/composition/models'

// zod-schema-faker needs its faker instance wired once before fake() can
// be called -- module-level, not per-call, same "do it once" shape as
// any other library setup call. Picked over @anatine/zod-mock (the
// other research finding, docs/SPEC.md §3.4): checked directly against
// npm, not assumed -- @anatine/zod-mock's peer dependency is
// `zod: '^3.21.4'` only, and Mill's frontend already pins zod v4.
// zod-schema-faker's own peer dependency (`zod: '^3.25.0 || ^4.0.0'`)
// actually supports what's installed.
setFaker(faker)

// The minimal shape both ConfigField (a node type's config) and
// AttributeDef (a workflow's declared Attributes schema, docs/adr/0008's
// test-input form) satisfy -- AttributeDef carries no Options list (§3.3's
// rule-builder Update note: "AttributeDef carries no Options list"), so
// it's optional here, same as the FieldOptions-with-no-Options fallback
// below already handles.
export interface TypedField {
  Key: string
  Type: ConfigFieldType
  Options?: string[] | null
}

// Builds an ad-hoc zod object schema from a node type's typed
// ConfigFields (or a workflow's typed Attributes -- both are "name +
// typed value" declarations, see TypedField above), so "generate a test
// payload" reuses the same schema language already adopted for
// draft-workflow validation (CompositionCanvas.tsx's draftWorkflowSchema)
// rather than introducing a second one. Every field always resolves to a
// real zod type -- an options field with no Options falls back to a
// plain string rather than z.enum([]), which zod itself rejects as
// invalid at schema-build time.
export function configFieldsToZodSchema(fields: TypedField[]) {
  const shape: Record<string, z.ZodTypeAny> = {}
  for (const field of fields) {
    switch (field.Type) {
      case ConfigFieldType.FieldNumber:
        shape[field.Key] = z.number()
        break
      case ConfigFieldType.FieldBoolean:
        shape[field.Key] = z.boolean()
        break
      case ConfigFieldType.FieldOptions:
        shape[field.Key] = field.Options && field.Options.length > 0 ? z.enum(field.Options as [string, ...string[]]) : z.string()
        break
      default:
        shape[field.Key] = z.string()
    }
  }
  return z.object(shape)
}

// Generates one example value per field, stringified the same way
// Node.Config (a node's config) and a run's Attribute-value override
// (executionservice.go's runInput.Values) both already store every
// value -- map[string]string regardless of declared Type, which only
// changes how the Inspector/test-input form renders or validates it,
// not the wire representation.
export function generateSamplePayload(fields: TypedField[]): Record<string, string> {
  const schema = configFieldsToZodSchema(fields)
  const sample = fake(schema) as Record<string, unknown>
  const out: Record<string, string> = {}
  for (const field of fields) {
    out[field.Key] = String(sample[field.Key] ?? '')
  }
  return out
}
