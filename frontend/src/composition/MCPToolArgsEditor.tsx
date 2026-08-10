import { useEffect, useState } from 'react'
import { Button, Checkbox, FormControl, Label, Select, Stack, Text, TextInput, Textarea } from '@primer/react'
import { ConfigureService } from '../shared/bindings'
import type { Tool } from '../../bindings/github.com/alicoding/mill/internal/adapters/mcpclient/models'
import type { AttributeDef } from '../../bindings/github.com/alicoding/mill/internal/domain/composition/models'
import { LiteralOrAttributeField } from '../shared/LiteralOrAttributeField'
import { parseToolInputSchema, type ToolSchemaField } from './mcpToolSchema'
import styles from '../shared/ListCard.module.css'

// The mcp-tool-call node's schema-driven arguments editor (docs/SPEC.md
// §3.6): once an MCP Server is picked, this fetches its live tool list
// (ConfigureService.ListMCPServerTools, the same "List tools" RPC
// Configure's own reference view already uses) and, once a tool with a
// real inputSchema is picked, renders one typed control per declared
// field -- replacing the previous raw-JSON-only authoring. A string
// field reuses the shared LiteralOrAttributeField (the same
// literal-or-"attr:<name>" control IntegrationBindingsEditor/
// ChildWorkflowBindingsEditor already use) since composition.go's
// resolveMCPArguments resolves that exact convention at run time,
// keeping the resolved value's real type (a number/boolean Attribute
// stays a number/boolean, not stringified -- deliberately different
// from resolveBindingValue's own always-stringify behavior, since MCP
// tool arguments are structured JSON).
//
// Owns toolName/argumentsJSON entirely -- NodeInspector.tsx skips both
// in its generic ConfigFields loop for this node type and renders this
// component instead.

function parseArgs(raw: string): Record<string, unknown> {
  if (!raw) return {}
  try {
    const parsed: unknown = JSON.parse(raw)
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

const RAW_ARGS_CAPTION =
  'Optional JSON object of arguments to pass to the tool. Top-level string values of the form "attr:<name>" ' +
  "resolve to the named Attribute's typed value at run time; every other value is sent as-is."

export function MCPToolArgsEditor({
  mcpServerId, toolName, argumentsRaw, attrs, onChangeToolName, onChangeArguments,
}: {
  mcpServerId: string
  toolName: string
  argumentsRaw: string
  attrs: AttributeDef[]
  onChangeToolName: (v: string) => void
  onChangeArguments: (raw: string) => void
}) {
  const [tools, setTools] = useState<Tool[] | 'failed' | null>(null)
  const [showRaw, setShowRaw] = useState(false)

  useEffect(() => {
    if (!mcpServerId) {
      setTools('failed')
      return
    }
    let cancelled = false
    setTools(null)
    ConfigureService.ListMCPServerTools(mcpServerId)
      .then((list) => { if (!cancelled) setTools(list ?? []) })
      .catch(() => { if (!cancelled) setTools('failed') })
    return () => { cancelled = true }
  }, [mcpServerId])

  const toolList = Array.isArray(tools) ? tools : null
  const selectedTool = toolList?.find((t) => t.Name === toolName)
  const schemaFields: ToolSchemaField[] = selectedTool ? parseToolInputSchema(selectedTool.InputSchema) : []

  const argsObj = parseArgs(argumentsRaw)
  const writeArgs = (next: Record<string, unknown>) => onChangeArguments(JSON.stringify(next))
  const setArg = (key: string, value: unknown) => writeArgs({ ...argsObj, [key]: value })
  const deleteArg = (key: string) => {
    const next = { ...argsObj }
    delete next[key]
    writeArgs(next)
  }

  const toolOptions = toolList
    ? (toolName && !toolList.some((t) => t.Name === toolName) ? [...toolList.map((t) => t.Name), toolName] : toolList.map((t) => t.Name))
    : []

  return (
    <Stack direction="vertical" gap="condensed" data-testid="mcp-tool-args-editor">
      {toolList ? (
        <FormControl>
          <FormControl.Label>Tool</FormControl.Label>
          <Select
            value={toolName}
            data-testid="mcp-tool-select"
            onChange={(e) => onChangeToolName(e.target.value)}
          >
            <Select.Option value="">(pick a tool)</Select.Option>
            {toolOptions.map((name) => (
              <Select.Option key={name} value={name}>{name}</Select.Option>
            ))}
          </Select>
          {selectedTool?.Description && (
            <Text as="p" size="small" className={styles.muted}>{selectedTool.Description}</Text>
          )}
        </FormControl>
      ) : (
        <FormControl>
          <FormControl.Label>Tool name</FormControl.Label>
          <FormControl.Caption>The exact tool name, from that server's own tool list.</FormControl.Caption>
          <TextInput
            value={toolName}
            block
            data-testid="mcp-tool-name-input"
            onChange={(e) => onChangeToolName(e.target.value)}
          />
        </FormControl>
      )}

      {schemaFields.length > 0 ? (
        <>
          <Text size="small" weight="semibold">Arguments</Text>
          {schemaFields.map((field) => (
            <ToolArgField
              key={field.name}
              field={field}
              value={argsObj[field.name]}
              attrs={attrs}
              onSet={(v) => setArg(field.name, v)}
              onDelete={() => deleteArg(field.name)}
            />
          ))}
          <Button
            size="small"
            variant="invisible"
            data-testid="mcp-args-raw-toggle"
            onClick={() => setShowRaw((v) => !v)}
          >
            {showRaw ? 'Hide raw JSON' : 'Raw JSON'}
          </Button>
          {showRaw && (
            <FormControl>
              <FormControl.Label visuallyHidden>Arguments (raw JSON)</FormControl.Label>
              <FormControl.Caption>{RAW_ARGS_CAPTION}</FormControl.Caption>
              <Textarea
                defaultValue={argumentsRaw}
                rows={4}
                block
                data-testid="mcp-args-raw"
                onBlur={(e) => onChangeArguments(e.target.value)}
              />
            </FormControl>
          )}
        </>
      ) : (
        <FormControl>
          <FormControl.Label>Arguments (JSON)</FormControl.Label>
          <FormControl.Caption>{RAW_ARGS_CAPTION}</FormControl.Caption>
          <Textarea
            defaultValue={argumentsRaw}
            rows={4}
            block
            data-testid="mcp-args-raw"
            onBlur={(e) => onChangeArguments(e.target.value)}
          />
        </FormControl>
      )}
    </Stack>
  )
}

// One typed control per ToolSchemaField -- split out so the map() above
// stays readable; not exported, this file's whole reason to exist is
// this switch.
function ToolArgField({ field, value, attrs, onSet, onDelete }: {
  field: ToolSchemaField
  value: unknown
  attrs: AttributeDef[]
  onSet: (value: unknown) => void
  onDelete: () => void
}) {
  const requiredBadge = field.required && <Label size="small" variant="accent">required</Label>

  switch (field.type) {
    case 'string':
      return (
        <LiteralOrAttributeField
          name={field.name}
          required={field.required}
          value={typeof value === 'string' ? value : ''}
          attrs={attrs}
          onChange={(v) => (v === '' ? onDelete() : onSet(v))}
        />
      )
    case 'enum':
      return (
        <FormControl>
          <FormControl.Label>
            {field.name} {requiredBadge}
          </FormControl.Label>
          {field.description && <FormControl.Caption>{field.description}</FormControl.Caption>}
          <Select
            aria-label={field.name}
            value={typeof value === 'string' ? value : ''}
            onChange={(e) => (e.target.value === '' ? onDelete() : onSet(e.target.value))}
          >
            <Select.Option value="">(unset)</Select.Option>
            {(field.enumValues ?? []).map((v) => (
              <Select.Option key={v} value={v}>{v}</Select.Option>
            ))}
          </Select>
        </FormControl>
      )
    case 'number':
      return (
        <FormControl>
          <FormControl.Label>
            {field.name} {requiredBadge}
          </FormControl.Label>
          {field.description && <FormControl.Caption>{field.description}</FormControl.Caption>}
          <TextInput
            type="number"
            block
            data-testid="mcp-arg-number"
            aria-label={field.name}
            value={typeof value === 'number' ? String(value) : ''}
            onChange={(e) => {
              const raw = e.target.value
              if (raw === '') { onDelete(); return }
              const num = parseFloat(raw)
              if (!Number.isNaN(num)) onSet(num)
            }}
          />
        </FormControl>
      )
    case 'boolean':
      return (
        <FormControl>
          <Checkbox
            checked={value === true}
            data-testid="mcp-arg-boolean"
            aria-label={field.name}
            onChange={(e) => onSet(e.target.checked)}
          />
          <FormControl.Label>
            {field.name} {requiredBadge}
          </FormControl.Label>
          {field.description && <FormControl.Caption>{field.description}</FormControl.Caption>}
        </FormControl>
      )
    case 'json':
    default:
      return (
        <FormControl>
          <FormControl.Label>
            {field.name} {requiredBadge}
          </FormControl.Label>
          {field.description && <FormControl.Caption>{field.description}</FormControl.Caption>}
          <Textarea
            key={field.name}
            defaultValue={typeof value === 'string' ? value : value !== undefined ? JSON.stringify(value, null, 1) : ''}
            rows={3}
            block
            aria-label={field.name}
            onBlur={(e) => {
              const raw = e.target.value
              if (raw === '') { onDelete(); return }
              try {
                onSet(JSON.parse(raw))
              } catch {
                onSet(raw)
              }
            }}
          />
        </FormControl>
      )
  }
}
