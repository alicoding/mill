import { useEffect, useState } from 'react'
import { Dialog, FormControl, Select, TextInput } from '@primer/react'
import { CompositionService, ConfigureService } from '../shared/bindings'
import { AuthType } from '../../bindings/github.com/alicoding/mill/internal/domain/httprequest/models'
import type { Workflow } from '../../bindings/github.com/alicoding/mill/internal/domain/composition/models'
import { Category } from '../../bindings/github.com/alicoding/mill/internal/domain/decision/models'
import { Shell, ProfileMode } from '../../bindings/github.com/alicoding/mill/internal/domain/execenv/models'

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
    case 'decision':
      return ((await ConfigureService.Decisions()) ?? []).map((d) => ({ ID: d.ID, Label: `${d.Label} (${d.Category})` }))
    case 'execenv':
      return (await ConfigureService.ExecEnvs()) ?? []
    default:
      return []
  }
}

const KIND_NOUN: Record<string, string> = {
  request: 'request',
  list: 'list',
  mcpserver: 'MCP server',
  workflow: 'callable workflow',
  decision: 'decision',
  execenv: 'execution environment',
}

// docs/adr/0010 §2: no quick-create for a workflow reference -- creating
// one is Composition's own existing "New workflow" flow, not a
// lightweight sub-form; the picker only lists what already exists.
const QUICK_CREATABLE_KINDS = new Set(['request', 'list', 'mcpserver', 'decision', 'execenv'])

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
      {/* An empty callable-workflow list is a dead end without saying
          how to fix it (reported from live use: "Select a callable
          workflow…" with zero options and no hint) -- name the exact
          next step instead of leaving a silent empty dropdown. */}
      {refKind === 'workflow' && entities !== null && entities.length === 0 && (
        <span data-testid="no-callable-workflows-hint">
          No callable workflows yet — create a workflow whose trigger is &quot;callable by another
          workflow&quot; (drag that trigger from the palette onto a new workflow&apos;s canvas), then pick it here.
        </span>
      )}
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
// docs/adr/0027: Category is required (and immutable once created), so
// a Decision's quick-create needs one more field than request/mcpserver's
// label+secondary shape -- still deliberately minimal (no Outputs/
// webhook here; Configure > Decisions is the canonical place to add
// those afterward, same "quick-create produces a usable starting point,
// Configure refines it" split every other kind here already has).
const DECISION_CATEGORY_LABEL: Record<string, string> = {
  [Category.CategoryApprove]: 'Approve',
  [Category.CategoryDeny]: 'Deny',
  [Category.CategoryManualReview]: 'Manual review',
  [Category.CategoryActionNeeded]: 'Action needed',
  [Category.CategoryUncategorized]: 'Uncategorized',
}

function QuickCreateDialog({ refKind, onCancel, onCreated }: { refKind: string; onCancel: () => void; onCreated: (id: string) => void }) {
  const [label, setLabel] = useState('')
  const [secondary, setSecondary] = useState('') // Base URL (request) or Command (mcpserver); unused for list/decision
  const [category, setCategory] = useState<Category>(Category.CategoryUncategorized)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const create = async () => {
    setSaving(true)
    setError('')
    try {
      let id: string
      switch (refKind) {
        case 'request': {
          const r = await ConfigureService.CreateHTTPRequest(label, secondary, 'GET', '', AuthType.AuthNone, null, '', null, null, '')
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
        case 'decision': {
          const d = await ConfigureService.CreateDecision(label, category, null, '')
          id = d.ID
          break
        }
        case 'execenv': {
          // Sensible, deterministic defaults (mirrors the seeded "Safe
          // sandbox" env's own shape) -- Configure > Execution
          // Environments is the canonical place to refine shell/dir/env
          // afterward, same "quick-create produces a usable starting
          // point" split every other kind here already has.
          const e = await ConfigureService.CreateExecEnv(label, Shell.ShellZsh, ProfileMode.ProfileClean, '<mill-temp>', null)
          id = e.ID
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

  const secondaryLabel = refKind === 'request' ? 'URL' : refKind === 'mcpserver' ? 'Command' : null

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
      {refKind === 'decision' && (
        <FormControl>
          <FormControl.Label>Category</FormControl.Label>
          <FormControl.Caption>Cannot be changed after creation -- duplicate this Decision to create one with a different category.</FormControl.Caption>
          <Select value={category} onChange={(e) => setCategory(e.target.value as Category)}>
            {Object.values(Category).filter((c) => c !== Category.$zero).map((c) => (
              <Select.Option key={c} value={c}>{DECISION_CATEGORY_LABEL[c] ?? c}</Select.Option>
            ))}
          </Select>
        </FormControl>
      )}
      {error && <FormControl.Caption>{error}</FormControl.Caption>}
    </Dialog>
  )
}
