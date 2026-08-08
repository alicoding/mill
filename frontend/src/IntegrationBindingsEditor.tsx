import { useEffect, useState } from 'react'
import { FormControl, Label, Select, Stack, Text } from '@primer/react'
import { ConfigureService } from '../bindings/github.com/alicoding/mill'
import type { Field, Operation } from '../bindings/github.com/alicoding/mill/internal/adapters/openapispec/models'
import type { AttributeDef } from '../bindings/github.com/alicoding/mill/internal/domain/composition/models'
import { LiteralOrAttributeField } from './LiteralOrAttributeField'

// ADR-0007 Phase 3: once a selected connector has an OpenAPI spec and
// path+method match one of its declared operations, this renders a
// binding row per declared input/output field instead of leaving
// integration-http's literal bodyTemplate as the only option. Silently
// renders nothing when there's no matching operation (no spec, or
// path/method don't match a declared one yet) -- same "no UI for a
// decision that doesn't exist" discipline as the rest of this codebase,
// not an error state.
const DISCARD = '__discard__'

function parseJSON(raw: string): Record<string, string> {
  if (!raw) return {}
  try {
    return JSON.parse(raw) as Record<string, string>
  } catch {
    return {}
  }
}

export function IntegrationBindingsEditor({
  connectorId, path, method, attrs, inputBindingsRaw, outputBindingsRaw, onChangeInputBindings, onChangeOutputBindings,
}: {
  connectorId: string
  path: string
  method: string
  attrs: AttributeDef[]
  inputBindingsRaw: string
  outputBindingsRaw: string
  onChangeInputBindings: (raw: string) => void
  onChangeOutputBindings: (raw: string) => void
}) {
  const [operation, setOperation] = useState<Operation | null | 'none'>(null)

  useEffect(() => {
    if (!connectorId || !path || !method) {
      setOperation('none')
      return
    }
    ConfigureService.ConnectorOperationFields(connectorId, path, method)
      .then(setOperation)
      .catch(() => setOperation('none'))
  }, [connectorId, path, method])

  if (operation === null || operation === 'none') return null
  const inputFields = operation.InputFields ?? []
  const outputFields = operation.OutputFields ?? []
  if (inputFields.length === 0 && outputFields.length === 0) return null

  const inputBindings = parseJSON(inputBindingsRaw)
  const outputBindings = parseJSON(outputBindingsRaw)

  const setInputBinding = (field: Field, value: string) => {
    onChangeInputBindings(JSON.stringify({ ...inputBindings, [field.Name]: value }))
  }
  const setOutputBinding = (field: Field, attrKey: string) => {
    const next = { ...outputBindings }
    if (attrKey === DISCARD) delete next[field.Name]
    else next[field.Name] = attrKey
    onChangeOutputBindings(JSON.stringify(next))
  }

  return (
    <Stack direction="vertical" gap="condensed" data-testid="integration-bindings-editor">
      {inputFields.length > 0 && (
        <>
          <Text size="small" weight="semibold">Input bindings</Text>
          {inputFields.map((field) => (
            <LiteralOrAttributeField
              key={field.Name}
              name={field.Alias ? `${field.Alias} (${field.Name})` : field.Name}
              badge={field.In}
              value={inputBindings[field.Name] ?? ''}
              attrs={attrs}
              onChange={(value) => setInputBinding(field, value)}
            />
          ))}
        </>
      )}
      {outputFields.length > 0 && (
        <>
          <Text size="small" weight="semibold">Output bindings</Text>
          {outputFields.map((field) => (
            <FormControl key={field.Name}>
              <FormControl.Label>
                {field.Alias ? `${field.Alias} (${field.Name})` : field.Name}
                {field.Path && <Label size="small" variant="accent">path: {field.Path}</Label>}
                {field.IsSecret && <Label size="small" variant="danger">secret</Label>}
              </FormControl.Label>
              {field.IsSecret ? (
                <FormControl.Caption>Secret fields cannot be written to an Attribute.</FormControl.Caption>
              ) : (
                <Select
                  aria-label={`Write ${field.Name} to`}
                  value={outputBindings[field.Name] ?? DISCARD}
                  onChange={(e) => setOutputBinding(field, e.target.value)}
                >
                  <Select.Option value={DISCARD}>(discard)</Select.Option>
                  {attrs.map((a) => (
                    <Select.Option key={a.Key} value={a.Key}>Attribute: {a.Label}</Select.Option>
                  ))}
                </Select>
              )}
            </FormControl>
          ))}
        </>
      )}
    </Stack>
  )
}
