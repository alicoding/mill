import { useEffect, useState } from 'react'
import { Dialog, FormControl, Select, TextInput } from '@primer/react'
import { CompositionService, ConfigureService } from '../../bindings/github.com/alicoding/mill'
import { AuthType } from '../../bindings/github.com/alicoding/mill/internal/domain/httprequest/models'
import type { Workflow } from '../../bindings/github.com/alicoding/mill/internal/domain/composition/models'

// A workflow is only a valid child-workflow target if it's rooted in
// trigger-callable (docs/adr/0010) -- mirrors trigger.ExtractTrigger's
// Go logic (the node with no incoming edge, among Kind: trigger nodes)
// so a real-event-rooted workflow (filesystem-watch, etc.) never shows
// up as pickable here, matching what the backend would reject anyway.
function isCallableWorkflow(wf: Workflow): boolean {
  const hasIncoming = new Set((wf.Edges ?? []).map((e) => e.Target))
  const root = (wf.Nodes ?? []).find((n) => !hasIncoming.has(n.ID))
  return root?.NodeTypeID === 'trigger-callable'
}

// docs/adr/0009: a live picker for a FieldText field whose value is the
// ID of a Configure-authored entity (requestId/listId/mcpServerId),
// replacing the previous "paste the ID by hand" gap. One generic
// component parameterized by RefKind rather than three near-duplicates
// -- the same "one mechanism, parameterized" shape RunKind/TypedField
// already established this session. RefKind "request" renamed from
// "connector" by ADR-0016.
const CREATE_NEW = '__create_new__'

interface Entity {
  ID: string
  Label: string
}

async function fetchEntities(refKind: string): Promise<Entity[]> {
  switch (refKind) {
    case 'request':
      return (await ConfigureService.HTTPRequests()) ?? []
    case 'list':
      return (await ConfigureService.Lists()) ?? []
    case 'mcpserver':
      return (await ConfigureService.MCPServers()) ?? []
    case 'workflow':
      return ((await CompositionService.Workflows()) ?? []).filter(isCallableWorkflow)
    default:
      return []
  }
}

const KIND_NOUN: Record<string, string> = {
  request: 'request',
  list: 'list',
  mcpserver: 'MCP server',
  workflow: 'callable workflow',
}

// docs/adr/0010 §2: no quick-create for a workflow reference -- creating
// one is Composition's own existing "New workflow" flow, not a
// lightweight sub-form; the picker only lists what already exists.
const QUICK_CREATABLE_KINDS = new Set(['request', 'list', 'mcpserver'])

export function EntityRefField({ refKind, value, onChange }: { refKind: string; value: string; onChange: (id: string) => void }) {
  const [entities, setEntities] = useState<Entity[] | null>(null)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')

  const refresh = () => {
    fetchEntities(refKind).then(setEntities).catch((err) => setError(String(err)))
  }

  useEffect(() => {
    refresh()
    // refKind is fixed per node type (a mounted field never switches
    // kind mid-life), so this only needs to run once per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleSelect = (id: string) => {
    if (id === CREATE_NEW) {
      setCreating(true)
      return
    }
    onChange(id)
  }

  return (
    <>
      <Select
        value={entities?.some((e) => e.ID === value) ? value : ''}
        data-testid="entity-ref-field"
        onChange={(e) => handleSelect(e.target.value)}
      >
        <Select.Option value="">
          {entities === null ? 'Loading…' : value ? `Unknown ${KIND_NOUN[refKind]} (${value})` : `Select a ${KIND_NOUN[refKind]}…`}
        </Select.Option>
        {(entities ?? []).map((entity) => (
          <Select.Option key={entity.ID} value={entity.ID}>{entity.Label}</Select.Option>
        ))}
        {QUICK_CREATABLE_KINDS.has(refKind) && (
          <Select.Option value={CREATE_NEW}>+ Create new {KIND_NOUN[refKind]}…</Select.Option>
        )}
      </Select>
      {error && <span>{error}</span>}
      {creating && (
        <QuickCreateDialog
          refKind={refKind}
          onCancel={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false)
            refresh()
            onChange(id)
          }}
        />
      )}
    </>
  )
}

// Deliberately a minimal subset of each ConfigureXxx.tsx page's own
// create form (docs/adr/0009 §3) -- just enough to produce a usable
// entity; the Configure page stays the canonical full-editing surface
// (secret, OpenAPI spec, entries, args) for refining it afterward.
function QuickCreateDialog({ refKind, onCancel, onCreated }: { refKind: string; onCancel: () => void; onCreated: (id: string) => void }) {
  const [label, setLabel] = useState('')
  const [secondary, setSecondary] = useState('') // Base URL (request) or Command (mcpserver); unused for list
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const create = async () => {
    setSaving(true)
    setError('')
    try {
      let id: string
      switch (refKind) {
        case 'request': {
          const r = await ConfigureService.CreateHTTPRequest(label, secondary, 'GET', AuthType.AuthNone, null, '', null, null, '')
          id = r.ID
          break
        }
        case 'list': {
          const l = await ConfigureService.CreateList(label, null)
          id = l.ID
          break
        }
        case 'mcpserver': {
          const s = await ConfigureService.CreateMCPServer(label, secondary, null)
          id = s.ID
          break
        }
        default:
          throw new Error(`unknown RefKind: ${refKind}`)
      }
      onCreated(id)
    } catch (err) {
      setError(String(err))
    } finally {
      setSaving(false)
    }
  }

  const secondaryLabel = refKind === 'request' ? 'Base URL' : refKind === 'mcpserver' ? 'Command' : null

  return (
    <Dialog
      title={`Create ${KIND_NOUN[refKind]}`}
      onClose={onCancel}
      footerButtons={[
        { content: 'Cancel', onClick: onCancel },
        { content: 'Create', buttonType: 'primary', onClick: create, disabled: saving || !label || (secondaryLabel !== null && !secondary) },
      ]}
    >
      <FormControl>
        <FormControl.Label>Label</FormControl.Label>
        <TextInput value={label} onChange={(e) => setLabel(e.target.value)} block />
      </FormControl>
      {secondaryLabel && (
        <FormControl>
          <FormControl.Label>{secondaryLabel}</FormControl.Label>
          <TextInput value={secondary} onChange={(e) => setSecondary(e.target.value)} block />
        </FormControl>
      )}
      {error && <FormControl.Caption>{error}</FormControl.Caption>}
    </Dialog>
  )
}
