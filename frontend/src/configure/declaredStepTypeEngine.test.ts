import { describe, expect, it } from 'vitest'
import { Engine } from '../../bindings/github.com/alicoding/mill/internal/domain/declaredsteptype/models'
import { bindingComplete, bindingFieldKeysFor, engineNodeTypeIdFor, refKindFor } from './declaredStepTypeEngine'

describe('engineNodeTypeIdFor', () => {
  it.each([
    [Engine.EngineHTTP, 'integration-http'],
    [Engine.EngineMCP, 'mcp-tool-call'],
    [Engine.EngineWorkflow, 'child-workflow'],
  ])('maps %s to %s', (engine, id) => {
    expect(engineNodeTypeIdFor(engine)).toBe(id)
  })

  it('returns empty for an unrecognized engine', () => {
    expect(engineNodeTypeIdFor('' as Engine)).toBe('')
  })
})

describe('bindingFieldKeysFor', () => {
  it('HTTP hides only requestId', () => {
    expect(bindingFieldKeysFor(Engine.EngineHTTP)).toEqual(new Set(['requestId']))
  })

  it('MCP hides both mcpServerId and toolName', () => {
    expect(bindingFieldKeysFor(Engine.EngineMCP)).toEqual(new Set(['mcpServerId', 'toolName']))
  })

  it('Workflow hides only workflowId', () => {
    expect(bindingFieldKeysFor(Engine.EngineWorkflow)).toEqual(new Set(['workflowId']))
  })
})

describe('refKindFor', () => {
  it.each([
    [Engine.EngineHTTP, 'request'],
    [Engine.EngineMCP, 'mcpserver'],
    [Engine.EngineWorkflow, 'workflow'],
  ])('maps %s to RefKind %s', (engine, refKind) => {
    expect(refKindFor(engine)).toBe(refKind)
  })
})

describe('bindingComplete', () => {
  it('HTTP needs only requestId', () => {
    expect(bindingComplete(Engine.EngineHTTP, '', '', '', '')).toBe(false)
    expect(bindingComplete(Engine.EngineHTTP, 'req-1', '', '', '')).toBe(true)
  })

  it('MCP needs both mcpServerId and toolName', () => {
    expect(bindingComplete(Engine.EngineMCP, '', 'srv-1', '', '')).toBe(false)
    expect(bindingComplete(Engine.EngineMCP, '', 'srv-1', 'do_thing', '')).toBe(true)
  })

  it('Workflow needs only workflowId', () => {
    expect(bindingComplete(Engine.EngineWorkflow, '', '', '', '')).toBe(false)
    expect(bindingComplete(Engine.EngineWorkflow, '', '', '', 'wf-1')).toBe(true)
  })

  it('an unrecognized engine is never complete', () => {
    expect(bindingComplete('' as Engine, 'x', 'y', 'z', 'w')).toBe(false)
  })
})
