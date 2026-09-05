import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Dialog, FormControl, Link, Select, Text, TextInput } from '@primer/react'
import { findCommand, runCommand } from '../shared/commands'
import { ReferencePeek } from './ReferencePeek'
import { AtlasService, CompositionService, ConfigureService } from '../shared/bindings'
import { AuthType } from '../../bindings/github.com/alicoding/mill/internal/domain/httprequest/models'
import type { Workflow } from '../../bindings/github.com/alicoding/mill/internal/domain/composition/models'
import { Category } from '../../bindings/github.com/alicoding/mill/internal/domain/decision/models'
import { Shell, ProfileMode } from '../../bindings/github.com/alicoding/mill/internal/domain/execenv/models'
import { Kind as AIProviderKind } from '../../bindings/github.com/alicoding/mill/internal/domain/aiprovider/models'

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
// already establishes. RefKind "request" renamed from
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
    // docs/adr/0035: trigger-system-event's workflowScope picker -- every
    // workflow is a valid scope target (not just callable ones, unlike
    // 'workflow' above), since any workflow can be the SOURCE of a
    // decision-parked/run-completed/run-failed/run-cancelled event.
    case 'workflow-scope':
      return (await CompositionService.Workflows()) ?? []
    case 'decision':
      return ((await ConfigureService.Decisions()) ?? []).map((d) => ({ ID: d.ID, Label: `${d.Label} (${d.Category})` }))
    case 'execenv':
      return (await ConfigureService.ExecEnvs()) ?? []
    case 'aiprovider':
      return (await ConfigureService.AIProviders()) ?? []
    case 'conversionprofile':
      return (await ConfigureService.ConversionProfiles()) ?? []
    // docs/goals/0066: atlas-card-* steps' Kind/Relation pickers -- a
    // bindings-populated dropdown over Atlas's own user-declared Kinds/
    // LinkKinds, the same "reuse the existing picker, parameterized by
    // RefKind" shape every other entity reference here already uses.
    case 'atlas-kind':
      return (await AtlasService.Kinds()) ?? []
    case 'atlas-linkkind':
      return (await AtlasService.LinkKinds()) ?? []
    default:
      return []
  }
}

function kindNounFor(t: (key: string) => string): Record<string, string> {
  return {
    request: t('entityRefField.kindNoun.request'),
    list: t('entityRefField.kindNoun.list'),
    mcpserver: t('entityRefField.kindNoun.mcpserver'),
    workflow: t('entityRefField.kindNoun.workflow'),
    'workflow-scope': t('entityRefField.kindNoun.workflow-scope'),
    decision: t('entityRefField.kindNoun.decision'),
    execenv: t('entityRefField.kindNoun.execenv'),
    aiprovider: t('entityRefField.kindNoun.aiprovider'),
    conversionprofile: t('entityRefField.kindNoun.conversionprofile'),
    'atlas-kind': t('entityRefField.kindNoun.atlas-kind'),
    'atlas-linkkind': t('entityRefField.kindNoun.atlas-linkkind'),
  }
}

// docs/adr/0010 §2: no quick-create for a workflow reference -- creating
// one is Composition's own existing "New workflow" flow, not a
// lightweight sub-form; the picker only lists what already exists.
const QUICK_CREATABLE_KINDS = new Set(['request', 'list', 'mcpserver', 'decision', 'execenv', 'aiprovider', 'conversionprofile'])

// readOnly (goal 0297): a read-only canvas never shows a control that
// does nothing -- the field renders its VALUE (the entity's label, or
// None) and, while the tab can be switched to edit, an Edit link that
// runs workflow.edit. Links are not disabled by an enclosing disabled
// fieldset, which is what makes this reachable inside the inspector.
export function EntityRefField({ refKind, value, onChange, readOnly }: { refKind: string; value: string; onChange: (id: string) => void; readOnly?: boolean }) {
  const { t } = useTranslation('configure')
  const KIND_NOUN = kindNounFor(t)
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

  if (readOnly) {
    return <ReadOnlyReference refKind={refKind} value={value} entities={entities} noun={KIND_NOUN[refKind]} />
  }
  return (
    <>
      <Select
        value={entities?.some((e) => e.ID === value) ? value : ''}
        data-testid="entity-ref-field"
        onChange={(e) => handleSelect(e.target.value)}
      >
        <Select.Option value="">
          {entities === null
            ? t('loading')
            : value
              ? t('entityRefField.unknownEntity', { noun: KIND_NOUN[refKind], value })
              : refKind === 'workflow-scope'
                ? t('entityRefField.allWorkflows')
                : t('entityRefField.selectEntity', { noun: KIND_NOUN[refKind] })}
        </Select.Option>
        {(entities ?? []).map((entity) => (
          <Select.Option key={entity.ID} value={entity.ID}>{entity.Label}</Select.Option>
        ))}
        {QUICK_CREATABLE_KINDS.has(refKind) && (
          <Select.Option value={CREATE_NEW}>{t('entityRefField.createNewEntity', { noun: KIND_NOUN[refKind] })}</Select.Option>
        )}
      </Select>
      {error && <span>{error}</span>}
      <ReferencePeek refKind={refKind} id={entities?.some((e) => e.ID === value) ? value : ''} noun={KIND_NOUN[refKind] ?? refKind} />
      {/* An empty callable-workflow list is a dead end without saying
          how to fix it (reported from live use: "Select a callable
          workflow…" with zero options and no hint) -- name the exact
          next step instead of leaving a silent empty dropdown. */}
      {refKind === 'workflow' && entities !== null && entities.length === 0 && (
        <span data-testid="no-callable-workflows-hint">
          {t('entityRefField.noCallableWorkflowsHint')}
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
export function decisionCategoryLabelFor(t: (key: string) => string): Record<string, string> {
  return {
    [Category.CategoryApprove]: t('entityRefField.decisionCategoryLabel.approve'),
    [Category.CategoryDeny]: t('entityRefField.decisionCategoryLabel.deny'),
    [Category.CategoryManualReview]: t('entityRefField.decisionCategoryLabel.manualReview'),
    [Category.CategoryActionNeeded]: t('entityRefField.decisionCategoryLabel.actionNeeded'),
    [Category.CategoryUncategorized]: t('entityRefField.decisionCategoryLabel.uncategorized'),
  }
}

function QuickCreateDialog({ refKind, onCancel, onCreated }: { refKind: string; onCancel: () => void; onCreated: (id: string) => void }) {
  const { t } = useTranslation('configure')
  const KIND_NOUN = kindNounFor(t)
  const DECISION_CATEGORY_LABEL = decisionCategoryLabelFor(t)
  const [label, setLabel] = useState('')
  const [secondary, setSecondary] = useState('') // Base URL (request/aiprovider) or Command (mcpserver); unused for list/decision
  const [category, setCategory] = useState<Category>(Category.CategoryUncategorized)
  const [aiKind, setAIKind] = useState<AIProviderKind>(AIProviderKind.KindOpenAICompat)
  const [aiModel, setAIModel] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const create = async () => {
    setSaving(true)
    setError('')
    try {
      let id: string
      switch (refKind) {
        case 'request': {
          const r = await ConfigureService.CreateHTTPRequest(label, secondary, 'GET', '', AuthType.AuthNone, '', null, '', null, null, '')
          id = r.ID
          break
        }
        case 'list': {
          const l = await ConfigureService.CreateList(label, '', null)
          id = l.ID
          break
        }
        case 'mcpserver': {
          const s = await ConfigureService.CreateMCPServer(label, secondary, null, null)
          id = s.ID
          break
        }
        case 'decision': {
          const d = await ConfigureService.CreateDecision(label, category, null, '')
          id = d.ID
          break
        }
        case 'aiprovider': {
          const p = await ConfigureService.CreateAIProvider(label, aiKind, secondary, aiModel, '')
          id = p.ID
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

  const secondaryLabel = refKind === 'request' ? t('entityRefField.url') : refKind === 'mcpserver' ? t('entityRefField.command') : null

  // docs/adr/0009 §3's own "minimal, usable starting point" bar, applied
  // to AIProvider's own required-field shape (aiprovider.Validate):
  // Model is always required; BaseURL only for openai-compatible (an
  // Anthropic provider defaults to the real api.anthropic.com when left
  // blank, same as the full Configure form).
  const createDisabled =
    saving ||
    !label ||
    (secondaryLabel !== null && !secondary) ||
    (refKind === 'aiprovider' && (!aiModel || (aiKind === AIProviderKind.KindOpenAICompat && !secondary)))

  return (
    <Dialog
      title={t('entityRefField.createEntityTitle', { noun: KIND_NOUN[refKind] })}
      onClose={onCancel}
      footerButtons={[
        { content: t('entityRefField.cancel'), onClick: onCancel },
        { content: t('entityRefField.create'), buttonType: 'primary', onClick: create, disabled: createDisabled },
      ]}
    >
      <FormControl>
        <FormControl.Label>{t('entityRefField.label')}</FormControl.Label>
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
          <FormControl.Label>{t('entityRefField.category')}</FormControl.Label>
          <FormControl.Caption>{t('entityRefField.categoryCaption')}</FormControl.Caption>
          <Select value={category} onChange={(e) => setCategory(e.target.value as Category)}>
            {Object.values(Category).filter((c) => c !== Category.$zero).map((c) => (
              <Select.Option key={c} value={c}>{DECISION_CATEGORY_LABEL[c] ?? c}</Select.Option>
            ))}
          </Select>
        </FormControl>
      )}
      {refKind === 'aiprovider' && (
        <>
          <FormControl>
            <FormControl.Label>{t('entityRefField.kind')}</FormControl.Label>
            <Select value={aiKind} onChange={(e) => setAIKind(e.target.value as AIProviderKind)}>
              <Select.Option value={AIProviderKind.KindOpenAICompat}>{t('entityRefField.openaiCompatOption')}</Select.Option>
              <Select.Option value={AIProviderKind.KindAnthropic}>{t('entityRefField.anthropicOption')}</Select.Option>
            </Select>
          </FormControl>
          <FormControl>
            <FormControl.Label>{t('entityRefField.baseUrl')}</FormControl.Label>
            <FormControl.Caption>
              {aiKind === AIProviderKind.KindAnthropic ? t('entityRefField.baseUrlCaptionAnthropic') : t('entityRefField.baseUrlCaptionOther')}
            </FormControl.Caption>
            <TextInput value={secondary} onChange={(e) => setSecondary(e.target.value)} placeholder={t('entityRefField.baseUrlPlaceholder')} block />
          </FormControl>
          <FormControl>
            <FormControl.Label>{t('entityRefField.model')}</FormControl.Label>
            <TextInput value={aiModel} onChange={(e) => setAIModel(e.target.value)} placeholder={t('entityRefField.modelPlaceholder')} block />
          </FormControl>
        </>
      )}
      {error && <FormControl.Caption>{error}</FormControl.Caption>}
    </Dialog>
  )
}

// The read-only rendering (goal 0297): the entity's label (or None),
// an Edit link when the tab can switch to edit, and the peek/open
// doors (goal 0312) -- anchors, never buttons, since buttons inside
// the inspector's disabled fieldset are disabled with it.
function ReadOnlyReference({ refKind, value, entities, noun }: { refKind: string; value: string; entities: Entity[] | null; noun: string }) {
  const { t } = useTranslation('configure')
  const editCommand = findCommand('workflow.edit')
  const canEdit = editCommand ? (editCommand.enabled?.() ?? true) : false
  const label = entities === null ? t('loading') : (entities.find((e) => e.ID === value)?.Label ?? (value ? t('entityRefField.unknownEntity', { noun, value }) : t('entityRefField.none')))
  return (
    <Text as="p" size="small" data-testid="entity-ref-readonly" style={{ margin: 0 }}>
      {label}
      {canEdit && (
        <>
          {' · '}
          <Link href="#" onClick={(e) => { e.preventDefault(); void runCommand('workflow.edit') }} data-testid="entity-ref-edit">{t('entityRefField.edit')}</Link>
        </>
      )}
      <ReferencePeek refKind={refKind} id={value} noun={noun} />
    </Text>
  )
}
