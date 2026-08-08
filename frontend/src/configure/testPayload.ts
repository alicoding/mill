import { z } from 'zod'
import { fake, setFaker } from 'zod-schema-faker/v4'
import { faker } from '@faker-js/faker'
import type { ManualField } from './openapiSynth'

// zod-schema-faker's faker instance is a library-global singleton, but
// which module happens to import (and therefore initialize) it first is
// not something this module should depend on -- shared/configSchema.ts
// already calls setFaker at its own module load, but relying on that
// running first purely because of app-wide import order is exactly the
// kind of implicit cross-bounded-context coupling ADR-0012 exists to
// avoid, and it breaks outright when this module's own test runs in
// isolation (no configSchema.ts import in the chain at all). setFaker is
// idempotent (confirmed directly -- it just reassigns the module-level
// instance), so calling it again here is a harmless, self-contained
// guarantee, not a second competing setup.
setFaker(faker)

// Generates an example value per declared input field, for
// ConnectorTestPanel's "generate a test payload" action (docs/adr/0013
// §5). Takes openapiSynth.ts's ManualField -- the client-side
// representation ConnectorForm already normalizes both schema-authoring
// modes into (Manual editor state directly, or a parsed pasted-OpenAPI
// spec via parseOpenAPIToOperations), not the raw bindings Field type,
// so this needs no separate backend round-trip to test an unsaved
// draft. A separate small adapter from shared/configSchema.ts's
// configFieldsToZodSchema/generateSamplePayload rather than reusing it
// directly: ManualField.type is OpenAPI's own vocabulary
// (string/number/integer/boolean/object/array), not ConfigFieldType's
// (text/number/boolean/options) -- different enough, and object/array
// deliberately fall back to a plain string (no nested-fake generation,
// same restraint already applied to output Path extraction, ADR-0011)
// that translating through the existing adapter would either lose
// information or need its own translation layer either way. Same
// underlying libraries (zod + zod-schema-faker), just a second small,
// self-contained setup call.
function zodForField(f: ManualField): z.ZodTypeAny {
  switch (f.type) {
    case 'number':
    case 'integer':
      return z.number()
    case 'boolean':
      return z.boolean()
    default:
      return z.string()
  }
}

// Every generated value is stringified -- TestConnectorRequest.Values
// is map[string]string on the Go side (openapispec.BuildRequest coerces
// back to the field's real JSON type when building the request body),
// matching how Node.Config/AttributeDef values are already stored as
// strings regardless of declared Type (shared/configSchema.ts's own
// generateSamplePayload does the same).
export function generateOperationSample(fields: ManualField[]): Record<string, string> {
  const shape: Record<string, z.ZodTypeAny> = {}
  for (const f of fields) shape[f.name] = zodForField(f)
  const schema = z.object(shape)
  const sample = fake(schema) as Record<string, unknown>
  const out: Record<string, string> = {}
  for (const f of fields) out[f.name] = String(sample[f.name] ?? '')
  return out
}
