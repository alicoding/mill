import { Button, Label, Stack, Text } from '@primer/react'
import { KeyIcon } from '@primer/octicons-react'
import type { Workflow } from '../../bindings/github.com/alicoding/mill/internal/domain/composition/models'
import { TruncatedCell } from '../shared/ResizableTable'
import { useHotkeyCapture } from './hotkeyCapture'
import { describeCron } from './cronDescribe'
import { findRootNode } from './triggerRowInfo'
import runbookStyles from '../shared/ListCard.module.css'

interface TriggerRowLabelProps {
  workflow: Workflow
  // Whether TriggerService currently has a live listener registered for
  // this workflow (TriggerService.ArmedWorkflows(), fetched once by
  // CompositionView and passed down as a map) -- the single source of
  // truth for "armed," not a client-side recomputation of Sync's own
  // gate (!Disabled && PublishedVersion > 0), which would risk drifting
  // from the real thing it's describing.
  armed: boolean
  publishing: boolean
  onPublish: (id: string) => void
  // Fires after an inline hotkey assign/unassign on this row so the
  // parent can refetch ArmedWorkflows() -- a fresh binding doesn't
  // itself tell this row whether it's armed (that's TriggerService's
  // Sync gate, a separate fact).
  onHotkeyChanged: () => void
}

// The Workflows-list row's trigger-derived label + affordance
// (docs/goals/0006-trigger-aware-workflows-list.md): what actually
// "runs" a workflow is its root Trigger node, not a generic per-row Run
// button, so the label and its live/not-live state come from that
// node's real type and config instead of a second, independent guess at
// the same thing. Shared by WorkflowsTable.tsx and WorkflowsCards.tsx.
export function TriggerRowLabel({ workflow, armed, publishing, onPublish, onHotkeyChanged }: TriggerRowLabelProps) {
  const rootNode = findRootNode(workflow.Nodes, workflow.Edges)
  const nodeTypeID = rootNode?.NodeTypeID ?? null

  // Hotkey needs its own live capture flow (decision 3); every other
  // branch below is a plain, non-interactive derivation from Config.
  if (nodeTypeID === 'trigger-hotkey') {
    return <HotkeyRowLabel workflow={workflow} armed={armed} publishing={publishing} onPublish={onPublish} onHotkeyChanged={onHotkeyChanged} />
  }

  if (!nodeTypeID) return null // no root node yet -- a malformed/empty graph, defensive only

  const config = rootNode?.Config ?? {}

  if (nodeTypeID === 'trigger-manual') {
    return (
      <Label size="small" variant="secondary" data-testid="trigger-row-label" data-trigger-type={nodeTypeID}>
        Manual
      </Label>
    )
  }

  if (nodeTypeID === 'trigger-callable') {
    return (
      <Label size="small" variant="secondary" data-testid="trigger-row-label" data-trigger-type={nodeTypeID}>
        Run by another workflow
      </Label>
    )
  }

  if (nodeTypeID === 'trigger-schedule') {
    const cron = (config.cron ?? '').trim()
    if (!cron) {
      return (
        <Label size="small" variant="secondary" data-testid="trigger-row-label" data-trigger-type={nodeTypeID}>
          no schedule set
        </Label>
      )
    }
    const description = describeCron(cron)
    const text = description.kind === 'invalid'
      ? cron // an invalid-but-non-empty cron shows the raw value, per the goal's own row-anatomy note
      : description.kind === 'shortcut'
        ? `Runs on the schedule shortcut ${description.value}`
        : description.text
    return (
      <ArmableTriggerRow nodeTypeID={nodeTypeID} text={text} armed={armed} publishing={publishing}
        onPublish={() => onPublish(workflow.ID)} />
    )
  }

  if (nodeTypeID === 'trigger-clipboard-watch') {
    return (
      <ArmableTriggerRow nodeTypeID={nodeTypeID} text="Watching clipboard" armed={armed} publishing={publishing}
        onPublish={() => onPublish(workflow.ID)} />
    )
  }

  if (nodeTypeID === 'trigger-filesystem-watch') {
    const path = (config.path ?? '').trim()
    if (!path) {
      return (
        <Label size="small" variant="secondary" data-testid="trigger-row-label" data-trigger-type={nodeTypeID}>
          no path configured
        </Label>
      )
    }
    const pattern = (config.pattern ?? '').trim()
    const text = pattern ? `${path} · ${pattern}` : path
    return (
      <ArmableTriggerRow nodeTypeID={nodeTypeID} text={text} armed={armed} publishing={publishing}
        onPublish={() => onPublish(workflow.ID)} />
    )
  }

  return null // an unknown root node type -- defensive, shouldn't happen against a saved workflow
}

// schedule/clipboard-watch/filesystem-watch share the same tri-state
// shape once "configured" is already known true by the caller (the
// unconfigured case returns its own plain Label above, before this is
// ever reached): armed (a success badge) vs configured-but-not-live
// (a greyed "not live" badge + a Publish CTA, since publishing the
// draft is literally what's blocking the trigger from arming --
// TriggerService.Sync's own gate is !Disabled && PublishedVersion > 0).
function ArmableTriggerRow({ nodeTypeID, text, armed, publishing, onPublish }: {
  nodeTypeID: string
  text: string
  armed: boolean
  publishing: boolean
  onPublish: () => void
}) {
  return (
    // wrap="wrap" + minWidth: 0 -- the Label/Button here (unlike
    // TruncatedCell's own text) don't shrink on their own; without
    // both, a long schedule/filesystem-watch description plus a
    // badge plus the Publish button can force this cell wider than
    // its growCollapse track, reintroducing the table-overflow bug
    // §3.8's long-column pattern exists to prevent (caught by
    // resizable-table.spec.ts's own overflow assertion, not assumed).
    <Stack direction="horizontal" gap="condensed" align="center" wrap="wrap" style={{ minWidth: 0 }} data-testid="trigger-row-label" data-trigger-type={nodeTypeID}>
      <TruncatedCell text={text} />
      {armed ? (
        <Label variant="success" size="small">armed</Label>
      ) : (
        <>
          <Label variant="attention" size="small">not live</Label>
          <Button size="small" variant="invisible" onClick={onPublish} disabled={publishing} data-testid="trigger-row-publish">
            {publishing ? 'Publishing…' : 'Publish'}
          </Button>
        </>
      )}
    </Stack>
  )
}

// Hotkey rows reuse hotkeyCapture.ts's existing hook rather than a
// second implementation (decision 3's own "simplest correct
// implementation: capture state local to the row component") -- the
// same press-to-record flow and conflict-error copy NodeInspector.tsx
// already uses, just triggered from the row instead of the canvas.
function HotkeyRowLabel({ workflow, armed, publishing, onPublish, onHotkeyChanged }: TriggerRowLabelProps) {
  const hk = useHotkeyCapture(workflow.ID, onHotkeyChanged)

  return (
    <Stack direction="horizontal" gap="condensed" align="center" wrap="wrap" style={{ minWidth: 0 }} data-testid="trigger-row-label" data-trigger-type="trigger-hotkey">
      {hk.recording ? (
        <Text size="small" className={runbookStyles.recording}>Press a combo… (Esc to cancel)</Text>
      ) : hk.binding ? (
        <>
          <Button
            size="small"
            variant="invisible"
            leadingVisual={KeyIcon}
            title="Click to change"
            onClick={hk.startRecording}
            data-testid="trigger-row-hotkey-combo"
          >
            {hk.binding}
          </Button>
          {armed ? (
            <Label variant="success" size="small">armed</Label>
          ) : (
            <>
              <Label variant="attention" size="small">not live</Label>
              <Button size="small" variant="invisible" onClick={() => onPublish(workflow.ID)} disabled={publishing} data-testid="trigger-row-publish">
                {publishing ? 'Publishing…' : 'Publish'}
              </Button>
            </>
          )}
        </>
      ) : (
        <Button size="small" variant="invisible" onClick={hk.startRecording} data-testid="row-add-hotkey">
          Add hotkey…
        </Button>
      )}
      {hk.error && <Text size="small" className={runbookStyles.error}>{hk.error}</Text>}
    </Stack>
  )
}
