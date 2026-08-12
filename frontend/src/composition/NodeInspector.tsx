import { useState } from 'react'
import { Browser } from '@wailsio/runtime'
import { Button, Checkbox, FormControl, Label, Select, Stack, Text, TextInput, Textarea } from '@primer/react'
import { KeyIcon } from '@primer/octicons-react'
import type { AttributeDef, NodeType } from '../../bindings/github.com/alicoding/mill/internal/domain/composition/models'
import { Type as ConfigFieldType } from '../../bindings/github.com/alicoding/mill/internal/domain/typedfield/models'
import type { RunStep } from '../shared/bindings'
import type { CanvasNode } from './canvasStore'
import { useHotkeyCapture, isAccessibilityError, ACCESSIBILITY_SETTINGS_URL } from './hotkeyCapture'
import { generateSamplePayload } from '../shared/configSchema'
import { EntityRefField } from '../configure/EntityRefField'
import { IntegrationBindingsEditor } from './IntegrationBindingsEditor'
import { ChildWorkflowBindingsEditor } from './ChildWorkflowBindingsEditor'
import { DecisionOutcomeBindingsEditor } from './DecisionOutcomeBindingsEditor'
import { MCPToolArgsEditor } from './MCPToolArgsEditor'
import { ListSearchParamsEditor } from './ListSearchParamsEditor'
import { WorkflowHoverPreview } from './WorkflowHoverPreview'
import { NodeGuardrailSection } from './NodeGuardrailSection'
import { NodeExecutionSection } from './NodeExecutionSection'
import { RulesetEditor } from './RulesetEditor'
import { SchedulePreview } from './SchedulePreview'
import styles from './CompositionCanvas.module.css'
import runbookStyles from '../shared/ListCard.module.css'

interface NodeInspectorProps {
  node: CanvasNode
  // The owning workflow's ID ('' for a not-yet-saved workflow) -- the
  // Guardrail section needs it for instance-scoped rules and the live
  // dry-run verdict (docs/adr/0019: workflow-level rules stay inline
  // in the Inspector; node-type/integration rules live in Configure).
  workflowId: string
  // The owning workflow's declared Attributes -- what integration-http's
  // binding editor offers as bindable fields (same source
  // DecisionEdgeInspector's rule builder already reads via
  // ruleTranslate.ts's fieldsFromAttributes).
  attrs: AttributeDef[]
  nodeType: NodeType | undefined
  // Every NodeType sharing this node's Kind -- the "Node type" swap
  // control's options. Passed down rather than the full nodeTypes list
  // since Kind never changes on swap (CompositionCanvas.tsx already
  // filters it once per selection).
  sameKindNodeTypes: NodeType[]
  hasWorkflow: boolean
  // Owned by CompositionCanvas.tsx, not this component: it's keyed by
  // *workflow* id (TriggerService.ListHotkeys() is a workflow-id-keyed
  // map, not a node-id-keyed one) and manages a live keydown-recording
  // subscription that must survive across a node re-selection, not reset
  // every time this component remounts.
  hotkeyCapture: ReturnType<typeof useHotkeyCapture>
  // This node's recorded step data on the run currently displayed on
  // this canvas, if any (docs/adr/0031 items 3/5) -- undefined when no
  // run is displayed, or this node hasn't executed (yet).
  runStep?: RunStep
  // docs/goals/0022-workflow-view-mode.md: renders every field/control
  // below inert via a native `<fieldset disabled>` wrapper -- see the
  // component body's own comment for why that's the chosen mechanism
  // over threading a readOnly prop through every sub-editor.
  readOnly: boolean
  onChangeType: (newType: NodeType) => void
  onConfigChange: (key: string, value: string) => void
}

// Extracted from CompositionCanvas.tsx once that file crossed the
// 500-line convention (CLAUDE.md) -- the node-selected half of the
// Inspector panel, same split shape as DecisionEdgeInspector.tsx already
// uses for the edge-selected half. payloadNonce (forces a fresh
// defaultValue on every config-field input after "Generate test
// payload" or a type swap) moved to local state here since nothing
// outside this component ever read it -- CompositionCanvas.tsx keys its
// render of this component by node id, so switching the selected node
// gets a clean remount rather than carrying stale nonce/local state
// across selections.
export function NodeInspector({ node, workflowId, attrs, nodeType, sameKindNodeTypes, hasWorkflow, hotkeyCapture, runStep, readOnly, onChangeType, onConfigChange }: NodeInspectorProps) {
  const [payloadNonce, setPayloadNonce] = useState(0)

  // A native `<fieldset disabled>` cascades to every descendant form
  // control (input/select/textarea/button) regardless of how deep it's
  // nested through other React components -- the "prefer rendering the
  // existing fields disabled over building a second inspector"
  // instruction (docs/goals/0022), applied once here instead of
  // threading a readOnly prop through IntegrationBindingsEditor/
  // ChildWorkflowBindingsEditor/MCPToolArgsEditor/DecisionOutcomeBindingsEditor/
  // RulesetEditor/EntityRefField individually. Border/margin/padding
  // reset since a bare <fieldset> renders visible chrome by default;
  // min-width:0 works around a real browser quirk (fieldsets default to
  // min-width:min-content, which can fight this panel's own flex
  // sizing). One real, deliberate gap: Primer's AnchoredOverlay/Dialog
  // portal their OPEN content outside this DOM subtree, so a control
  // already-open inside one (e.g. WorkflowHoverPreview's "Open" button)
  // isn't disabled by this -- harmless here, since every trigger that
  // OPENS such an overlay (EntityRefField's "+ Create new" option, the
  // hotkey-capture buttons) is itself a normal descendant control this
  // fieldset does disable, so the overlay can never be opened in the
  // first place while read-only.
  return (
    <fieldset disabled={readOnly} className={styles.inspectorFieldset} data-testid="inspector-fieldset">
    <Stack direction="vertical" gap="condensed">
      <NodeExecutionSection step={runStep} />
      {/* Swapping type in place (same Kind only) instead of
          delete-and-redrag is what actually resolves the "why can't I
          add another trigger" dead end the palette's disabled Trigger
          entries raise -- a real user hit this exact confusion
          (docs/SPEC.md §3): they already had a manual trigger and wanted
          a different trigger *event*, not a second trigger. Only shown
          when there's an actual choice -- most Kinds (Capture, Decision)
          have exactly one NodeType today, where a single-option dropdown
          would be noise, not a real control (same reasoning as §3.5's
          Configure recheck: no UI for a decision that doesn't exist
          yet). */}
      {sameKindNodeTypes.length > 1 ? (
        <FormControl>
          <FormControl.Label>Node type</FormControl.Label>
          <Select
            value={node.data.nodeTypeID}
            data-testid="change-node-type"
            onChange={(e) => {
              const newType = sameKindNodeTypes.find((nt) => nt.ID === e.target.value)
              if (!newType) return
              onChangeType(newType)
              setPayloadNonce((n) => n + 1)
            }}
          >
            {sameKindNodeTypes.map((nt) => (
              <Select.Option key={nt.ID} value={nt.ID}>{nt.Label}</Select.Option>
            ))}
          </Select>
        </FormControl>
      ) : (
        <Text weight="semibold">{node.data.label}</Text>
      )}

      {/* trigger-hotkey has no ConfigFields (docs/SPEC.md §3.4: the
          binding lives in TriggerService, not Node.Config -- pressing a
          combo is better UX than typing one into a text field) --
          special-cased on NodeTypeID the same way the palette already
          special-cases node types, not a generic ConfigField. */}
      {node.data.nodeTypeID === 'trigger-hotkey' && (
        <Stack direction="vertical" gap="condensed">
          {!hasWorkflow && (
            <Text size="small" className={runbookStyles.muted}>
              Save this workflow before assigning a hotkey.
            </Text>
          )}
          {hasWorkflow && (
            <>
              {hotkeyCapture.recording ? (
                <Text size="small" className={styles.inspectorRecording}>Press a combo… (Esc to cancel)</Text>
              ) : hotkeyCapture.binding ? (
                <Stack direction="horizontal" gap="condensed" align="center">
                  <Label variant="secondary">
                    <KeyIcon size={12} /> {hotkeyCapture.binding}
                  </Label>
                  <Button size="small" variant="invisible" onClick={hotkeyCapture.startRecording}>Change</Button>
                  <Button size="small" variant="invisible" onClick={hotkeyCapture.clear}>Clear</Button>
                </Stack>
              ) : (
                <Button size="small" variant="invisible" onClick={hotkeyCapture.startRecording}>
                  Set shortcut
                </Button>
              )}
              {hotkeyCapture.error && (
                <Stack direction="vertical" gap="condensed">
                  <Text as="p" size="small" className={runbookStyles.error}>{hotkeyCapture.error}</Text>
                  {isAccessibilityError(hotkeyCapture.error) && (
                    <Button size="small" onClick={() => Browser.OpenURL(ACCESSIBILITY_SETTINGS_URL)}>
                      Open Accessibility Settings
                    </Button>
                  )}
                </Stack>
              )}
            </>
          )}
        </Stack>
      )}

      {(nodeType?.ConfigFields ?? []).length === 0 && node.data.nodeTypeID !== 'trigger-hotkey' && (
        <Text size="small" className={runbookStyles.muted}>This node type takes no configuration.</Text>
      )}

      {/* Trigger nodes specifically, not any node with fields -- this is
          "generate a sample input to test this trigger with," the same
          per-record test-harness idea named from the reference platform
          (docs/SPEC.md §3.2), not a generic fill-any-field convenience. */}
      {node.data.kind === 'trigger' && (nodeType?.ConfigFields ?? []).length > 0 && (
        <Button
          size="small"
          variant="invisible"
          data-testid="generate-test-payload"
          onClick={() => {
            const sample = generateSamplePayload(nodeType?.ConfigFields ?? [])
            for (const [key, value] of Object.entries(sample)) {
              onConfigChange(key, value)
            }
            setPayloadNonce((n) => n + 1)
          }}
        >
          Generate test payload
        </Button>
      )}

      {(nodeType?.ConfigFields ?? [])
        // toolName/argumentsJSON stay declared in Go ConfigFields (ADR-0025's
        // list_node_types introspection is the LLM-authoring vocabulary,
        // docs/SPEC.md §3.6) but are owned and rendered by MCPToolArgsEditor
        // below instead of this generic loop -- a schema-driven tool
        // picker and typed-argument fields, not a raw text box.
        .filter((field) => !(node.data.nodeTypeID === 'mcp-tool-call' && (field.Key === 'toolName' || field.Key === 'argumentsJSON')))
        .filter((field) => !(node.data.nodeTypeID === 'list-search' && field.Key === 'matchParams'))
        .map((field) => (
        <FormControl key={`${field.Key}-${payloadNonce}`}>
          <FormControl.Label>{field.Label}</FormControl.Label>
          {field.Description && <FormControl.Caption>{field.Description}</FormControl.Caption>}
          {field.RefKind ? (
            <>
              <EntityRefField
                refKind={field.RefKind}
                value={node.data.config[field.Key] ?? ''}
                onChange={(id) => onConfigChange(field.Key, id)}
              />
              {/* Hover-preview + jump for a selected workflow reference
                  (docs/SPEC.md §3.8's n8n/[decisioning-vendor] pattern) -- see the
                  child's real layout and open it in its own editor tab
                  without hunting through the Workflows list. */}
              {field.RefKind === 'workflow' && (node.data.config[field.Key] ?? '') !== '' && (
                <WorkflowHoverPreview workflowId={node.data.config[field.Key]}>
                  <Text size="small" className={runbookStyles.muted} style={{ cursor: 'default', textDecoration: 'underline dotted' }}>
                    Hover to preview the child — click Open to edit it
                  </Text>
                </WorkflowHoverPreview>
              )}
            </>
          ) : field.Type === ConfigFieldType.TypeBoolean ? (
            <Checkbox
              defaultChecked={node.data.config[field.Key] === 'true'}
              data-testid="canvas-config-field"
              onChange={(e) => onConfigChange(field.Key, String(e.target.checked))}
            />
          ) : field.Type === ConfigFieldType.TypeOptions ? (
            <Select
              defaultValue={node.data.config[field.Key] ?? ''}
              data-testid="canvas-config-field"
              onChange={(e) => onConfigChange(field.Key, e.target.value)}
            >
              {(field.Options ?? []).map((opt) => (
                <Select.Option key={opt} value={opt}>{opt}</Select.Option>
              ))}
            </Select>
          ) : field.Type === ConfigFieldType.TypeNumber ? (
            <TextInput
              type="number"
              defaultValue={node.data.config[field.Key] ?? ''}
              block
              data-testid="canvas-config-field"
              onBlur={(e) => onConfigChange(field.Key, e.target.value)}
            />
          ) : field.Suggestions && field.Suggestions.length > 0 ? (
            // FieldText with Suggestions (e.g. integration-http's Method,
            // ADR-0016) -- rendered as a real Select, by direct user
            // decision ("METHOD should not be free form text; same for
            // all fields that is typed"), replacing the earlier
            // input+datalist. The wire stays an open FieldText: a
            // persisted value outside the suggested set (a custom verb)
            // renders as an extra option instead of breaking, so
            // nothing already saved is rejected -- only the authoring
            // UI presents a typed choice.
            <Select
              defaultValue={node.data.config[field.Key] ?? ''}
              block
              data-testid="canvas-config-field"
              onChange={(e) => onConfigChange(field.Key, e.target.value)}
            >
              {(() => {
                const current = node.data.config[field.Key] ?? ''
                const options = field.Suggestions.includes(current) || current === ''
                  ? field.Suggestions
                  : [...field.Suggestions, current]
                // The blank option keeps "unset" expressible -- what
                // blank means is field-specific (for integration-http's
                // method: inherit the request's own) and stated in the
                // field's Description caption, not hardcoded here.
                return [
                  <Select.Option key="" value="">(default)</Select.Option>,
                  ...options.map((s) => <Select.Option key={s} value={s}>{s}</Select.Option>),
                ]
              })()}
            </Select>
          ) : field.Multiline ? (
            <Textarea
              defaultValue={node.data.config[field.Key] ?? ''}
              rows={4}
              block
              data-testid="canvas-config-field"
              onBlur={(e) => onConfigChange(field.Key, e.target.value)}
            />
          ) : (
            // Single-line by default (a key name, a cron string, a
            // path); only fields DECLARED multi-line (ConfigField.
            // Multiline -- an HTML payload, a JSON object) get a
            // textarea. Every text field rendering 4 rows tall was a
            // systemic spacing bug, reported directly with screenshots.
            <TextInput
              defaultValue={node.data.config[field.Key] ?? ''}
              block
              data-testid="canvas-config-field"
              onBlur={(e) => onConfigChange(field.Key, e.target.value)}
            />
          )}
        </FormControl>
      ))}

      {workflowId && node.data.kind !== 'trigger' && node.data.kind !== 'decision' && (
        <NodeGuardrailSection workflowId={workflowId} nodeId={node.id} />
      )}

      {node.data.nodeTypeID === 'trigger-schedule' && (
        <SchedulePreview cron={node.data.config.cron ?? ''} />
      )}

      {node.data.nodeTypeID === 'ruleset' && (
        <RulesetEditor
          rulesRaw={node.data.config.rulesJSON ?? ''}
          attrs={attrs}
          onChange={(raw) => onConfigChange('rulesJSON', raw)}
        />
      )}

      {node.data.nodeTypeID === 'integration-http' && (
        <IntegrationBindingsEditor
          requestId={node.data.config.requestId ?? ''}
          attrs={attrs}
          inputBindingsRaw={node.data.config.inputBindings ?? ''}
          outputBindingsRaw={node.data.config.outputBindings ?? ''}
          onChangeInputBindings={(raw) => onConfigChange('inputBindings', raw)}
          onChangeOutputBindings={(raw) => onConfigChange('outputBindings', raw)}
        />
      )}

      {node.data.nodeTypeID === 'child-workflow' && (
        <ChildWorkflowBindingsEditor
          workflowId={node.data.config.workflowId ?? ''}
          attrs={attrs}
          inputBindingsRaw={node.data.config.inputBindings ?? ''}
          onChangeInputBindings={(raw) => onConfigChange('inputBindings', raw)}
        />
      )}

      {node.data.nodeTypeID === 'mcp-tool-call' && (
        <MCPToolArgsEditor
          mcpServerId={node.data.config.mcpServerId ?? ''}
          toolName={node.data.config.toolName ?? ''}
          argumentsRaw={node.data.config.argumentsJSON ?? ''}
          attrs={attrs}
          onChangeToolName={(v) => onConfigChange('toolName', v)}
          onChangeArguments={(raw) => onConfigChange('argumentsJSON', raw)}
        />
      )}

      {node.data.nodeTypeID === 'list-search' && (
        <ListSearchParamsEditor
          listId={node.data.config.listId ?? ''}
          matchParamsRaw={node.data.config.matchParams ?? ''}
          attrs={attrs}
          onChangeMatchParams={(raw) => onConfigChange('matchParams', raw)}
        />
      )}

      {node.data.nodeTypeID === 'decision-outcome' && (
        <DecisionOutcomeBindingsEditor
          decisionId={node.data.config.decisionId ?? ''}
          attrs={attrs}
          outputBindingsRaw={node.data.config.outputBindings ?? ''}
          onChangeOutputBindings={(raw) => onConfigChange('outputBindings', raw)}
        />
      )}
    </Stack>
    </fieldset>
  )
}
