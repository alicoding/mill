import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FormControl, Select, TextInput } from '@primer/react'
import { ConfigureService } from '../shared/bindings'
import type { Tool } from '../../bindings/github.com/alicoding/mill/internal/adapters/mcpclient/models'
import { Engine } from '../../bindings/github.com/alicoding/mill/internal/domain/declaredsteptype/models'
import { EntityRefField } from './EntityRefField'

export interface EngineBinding {
  engine: Engine
  requestID: string
  mcpServerID: string
  toolName: string
  workflowID: string
}

// The step designer's "which operation, on the engine the caller
// already picked" half of the form (ADR-0037 Decision 1): renders
// exactly one of the three existing RefKind pickers EntityRefField
// already establishes (request/mcpserver/workflow), keyed off
// binding.engine -- reused directly, never forked, same picker every
// other Configure entity/canvas node config uses for these RefKinds.
// The engine CHOICE itself belongs to the caller (ConfigureStepTypes.tsx
// also needs a "needs code" option alongside the three real engines,
// which isn't part of this binding's own shape). MCP additionally
// needs a tool name once a server is picked; this fetches that
// server's live tool list (ConfigureService.ListMCPServerTools) the
// same way MCPToolArgsEditor.tsx's own tool picker does, falling back
// to typing the exact name when the server can't be reached -- a
// narrower version of that component's first control, since the
// designer only needs to NAME a tool here, not build its call
// arguments (MCPToolArgsEditor.tsx owns that once a node is placed on
// a canvas).
export function StepTypeEngineBindingFields({ binding, onChange }: {
  binding: EngineBinding
  onChange: (next: EngineBinding) => void
}) {
  const { t } = useTranslation('configure')
  const [tools, setTools] = useState<Tool[] | 'failed' | null>(null)

  useEffect(() => {
    if (binding.engine !== Engine.EngineMCP || !binding.mcpServerID) {
      setTools('failed')
      return
    }
    let cancelled = false
    setTools(null)
    ConfigureService.ListMCPServerTools(binding.mcpServerID)
      .then((list) => { if (!cancelled) setTools(list ?? []) })
      .catch(() => { if (!cancelled) setTools('failed') })
    return () => { cancelled = true }
  }, [binding.engine, binding.mcpServerID])

  const toolList = Array.isArray(tools) ? tools : null
  const toolOptions = toolList
    ? (binding.toolName && !toolList.some((tool) => tool.Name === binding.toolName)
      ? [...toolList.map((tool) => tool.Name), binding.toolName]
      : toolList.map((tool) => tool.Name))
    : []

  return (
    <>
      {binding.engine === Engine.EngineHTTP && (
        <FormControl>
          <FormControl.Label>{t('configureStepTypes.httpOperation')}</FormControl.Label>
          <EntityRefField refKind="request" value={binding.requestID} onChange={(id) => onChange({ ...binding, requestID: id })} />
        </FormControl>
      )}

      {binding.engine === Engine.EngineMCP && (
        <>
          <FormControl>
            <FormControl.Label>{t('configureStepTypes.mcpServer')}</FormControl.Label>
            <EntityRefField refKind="mcpserver" value={binding.mcpServerID} onChange={(id) => onChange({ ...binding, mcpServerID: id, toolName: '' })} />
          </FormControl>
          <FormControl>
            <FormControl.Label>{t('configureStepTypes.mcpTool')}</FormControl.Label>
            {toolList ? (
              <Select
                value={binding.toolName}
                data-testid="steptype-mcp-tool-select"
                onChange={(e) => onChange({ ...binding, toolName: e.target.value })}
              >
                <Select.Option value="">{t('configureStepTypes.pickTool')}</Select.Option>
                {toolOptions.map((name) => (
                  <Select.Option key={name} value={name}>{name}</Select.Option>
                ))}
              </Select>
            ) : (
              <>
                <FormControl.Caption>{t('configureStepTypes.mcpToolFallbackCaption')}</FormControl.Caption>
                <TextInput
                  value={binding.toolName}
                  block
                  data-testid="steptype-mcp-tool-input"
                  onChange={(e) => onChange({ ...binding, toolName: e.target.value })}
                />
              </>
            )}
          </FormControl>
        </>
      )}

      {binding.engine === Engine.EngineWorkflow && (
        <FormControl>
          <FormControl.Label>{t('configureStepTypes.callableWorkflow')}</FormControl.Label>
          <EntityRefField refKind="workflow" value={binding.workflowID} onChange={(id) => onChange({ ...binding, workflowID: id })} />
        </FormControl>
      )}
    </>
  )
}
