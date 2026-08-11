import { useEffect, useState } from 'react'
import { FormControl, Label, Select, Stack, Text } from '@primer/react'
import { ConfigureService } from '../shared/bindings'
import type { Field, Operation } from '../../bindings/github.com/alicoding/mill/internal/adapters/openapispec/models'
import type { AttributeDef } from '../../bindings/github.com/alicoding/mill/internal/domain/composition/models'
import { LiteralOrAttributeField } from '../shared/LiteralOrAttributeField'

// ADR-0007 Phase 3, reshaped by the transport-lives-on-the-integration
// decision: the node no longer authors path/method, so this editor
// resolves the selected integration's own declared operation itself --
// list its operations, take the single one (the 1:1 request:operation
// model; a legacy multi-operation spec uses its first, in
// ListHTTPRequestOperations' stable order), and render a binding row
// per declared input/output field. Silently renders nothing when
// there's no spec or no operation -- same "no UI for a decision that
// doesn't exist" discipline as the rest of this codebase, not an error
// state.
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
  requestId, attrs, inputBindingsRaw, outputBindingsRaw, onChangeInputBindings, onChangeOutputBindings,
}: {
  requestId: string
  attrs: AttributeDef[]
  inputBindingsRaw: string
  outputBindingsRaw: string
  onChangeInputBindings: (raw: string) => void
  onChangeOutputBindings: (raw: string) => void
}) {
  const [operation, setOperation] = useState<Operation | null | 'none'>(null)

  useEffect(() => {
    if (!requestId) {
      setOperation('none')
      return
    }
    let cancelled = false
    ConfigureService.ListHTTPRequestOperations(requestId)
      .then((ops) => {
        const list = ops ?? []
        if (list.length === 0) throw new Error('no operations')
        return ConfigureService.HTTPRequestOperationFields(requestId, list[0].Path, list[0].Method)
      })
      .then((op) => { if (!cancelled) setOperation(op) })
      .catch(() => { if (!cancelled) setOperation('none') })
    return () => { cancelled = true }
  }, [requestId])

  if (operation === null || operation === 'none') return null
  const inputFields = operation.InputFields ?? []
  const outputFields = operation.OutputFields ?? []
  if (inputFields.length === 0 && outputFields.length === 0) return null

  const inputBindings = parseJSON(inputBindingsRaw)
  const outputBindings = parseJSON(outputBindingsRaw)

  const setInputBinding = (field: Field, value: string) => {
    onChangeInputBindings(JSON.stringify({ ...inputBindings, [field.Key]: value }))
  }
  const setOutputBinding = (field: Field, attrKey: string) => {
    const next = { ...outputBindings }
    if (attrKey === DISCARD) delete next[field.Key]
    else next[field.Key] = attrKey
    onChangeOutputBindings(JSON.stringify(next))
  }

  return (
    <Stack direction="vertical" gap="condensed" data-testid="integration-bindings-editor">
      {inputFields.length > 0 && (
        <>
          <Text size="small" weight="semibold">Input bindings</Text>
          {inputFields.map((field) => (
            <LiteralOrAttributeField
              key={field.Key}
              name={field.Label ? `${field.Label} (${field.Key})` : field.Key}
              badge={field.In}
              value={inputBindings[field.Key] ?? ''}
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
            <FormControl key={field.Key}>
              <FormControl.Label>
                {field.Label ? `${field.Label} (${field.Key})` : field.Key}
                {field.Path && <Label size="small" variant="accent">path: {field.Path}</Label>}
                {field.Secret && <Label size="small" variant="danger">secret</Label>}
              </FormControl.Label>
              {field.Secret ? (
                <FormControl.Caption>Secret fields cannot be written to an Attribute.</FormControl.Caption>
              ) : (
                <Select
                  aria-label={`Write ${field.Key} to`}
                  value={outputBindings[field.Key] ?? DISCARD}
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
