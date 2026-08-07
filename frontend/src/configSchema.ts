import { z } from 'zod'
import { fake, setFaker } from 'zod-schema-faker/v4'
import { faker } from '@faker-js/faker'
import { ConfigFieldType, type ConfigField } from '../bindings/github.com/alicoding/mill/internal/domain/composition/models'

// zod-schema-faker needs its faker instance wired once before fake() can
// be called -- module-level, not per-call, same "do it once" shape as
// any other library setup call. Picked over @anatine/zod-mock (the
// other research finding, docs/SPEC.md §3.4): checked directly against
// npm, not assumed -- @anatine/zod-mock's peer dependency is
// `zod: '^3.21.4'` only, and Mill's frontend already pins zod v4.
// zod-schema-faker's own peer dependency (`zod: '^3.25.0 || ^4.0.0'`)
// actually supports what's installed.
setFaker(faker)

// Builds an ad-hoc zod object schema from a node type's typed
// ConfigFields, so "generate a test payload" reuses the same schema
// language already adopted for draft-workflow validation
// (CompositionCanvas.tsx's draftWorkflowSchema) rather than introducing
// a second one. Every field always resolves to a real zod type -- an
// options field with no Options falls back to a plain string rather
// than z.enum([]), which zod itself rejects as invalid at schema-build
// time.
export function configFieldsToZodSchema(fields: ConfigField[]) {
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
// Node.Config already stores every value (composition.go's ConfigField
// is Go's map[string]string regardless of Type -- Type only changes how
// the Inspector renders/validates it, not the wire representation).
export function generateSamplePayload(fields: ConfigField[]): Record<string, string> {
  const schema = configFieldsToZodSchema(fields)
  const sample = fake(schema) as Record<string, unknown>
  const out: Record<string, string> = {}
  for (const field of fields) {
    out[field.Key] = String(sample[field.Key] ?? '')
  }
  return out
}
