import type { Ref } from 'react'
import { Button, FormControl, IconButton, Label, Stack, Text, TextInput, Textarea } from '@primer/react'
import { ChevronDownIcon, ChevronUpIcon, EyeIcon, PencilIcon } from '@primer/octicons-react'
import type { Workflow } from '../../bindings/github.com/alicoding/mill/internal/domain/composition/models'
import { RunButton, type RunButtonHandle } from './LiveRunControls'
import styles from './CompositionCanvas.module.css'
import runbookStyles from '../shared/ListCard.module.css'

interface CanvasMetaHeaderProps {
  workflow: Workflow | null | undefined
  draftLabel: string
  onLabelChange: (label: string) => void
  descOpen: boolean
  onToggleDesc: () => void
  draftDescription: string
  onDescriptionChange: (description: string) => void
  save: () => void
  saving: boolean
  saveError: string
  runButtonRef: Ref<RunButtonHandle>
  onStartRun: (values: Record<string, string>, stepped?: boolean, payload?: string) => void
  // docs/goals/0022-workflow-view-mode.md: Save hides and an Edit
  // button takes its place; Label/Description become read-only
  // (disabled, not hidden -- still worth seeing at a glance).
  readOnly: boolean
  onSwitchToEdit?: () => void
}

// The canvas's own label/description/Save/Run bar -- split out of
// CompositionCanvas.tsx at the 500-line limit (CLAUDE.md), same
// "extract along a real seam" discipline as CanvasNodeView/NodePalette
// before it. Purely presentational plus the two plain text inputs;
// every piece of state it touches (draftLabel/draftDescription/
// descOpen/saveError/saving) still lives in CanvasInner, passed down.
export function CanvasMetaHeader({
  workflow,
  draftLabel,
  onLabelChange,
  descOpen,
  onToggleDesc,
  draftDescription,
  onDescriptionChange,
  save,
  saving,
  saveError,
  runButtonRef,
  onStartRun,
  readOnly,
  onSwitchToEdit,
}: CanvasMetaHeaderProps) {
  return (
    <div className={styles.metaHeader}>
      <Stack direction="horizontal" gap="condensed" align="center">
        <TextInput
          value={draftLabel}
          onChange={(e) => onLabelChange(e.target.value)}
          aria-label="Label"
          placeholder="My workflow"
          size="small"
          disabled={readOnly}
          className={styles.metaTitleInput}
        />
        <IconButton
          icon={descOpen ? ChevronUpIcon : ChevronDownIcon}
          aria-label={descOpen ? 'Hide details' : 'Add details'}
          size="small"
          onClick={onToggleDesc}
          data-testid="toggle-description"
        />
        {readOnly ? (
          <>
            {/* docs/goals/0036-view-mode-ux-hardening.md item 2: the
                ambient cue that this canvas is read-only, present before
                any interaction -- the fieldset-disabled inspector fields
                only reveal themselves as inert once a node is selected;
                this chip is visible the moment the tab opens. Same Label
                family as the row-level 'v1 live'/'draft'/'disabled'
                badges (CompositionView.tsx) and the hotkey-binding badge
                (NodeInspector.tsx) -- one recognizable idiom, not a new
                one just for this. */}
            <Label variant="secondary" size="small" data-testid="view-mode-chip">
              <EyeIcon size={12} /> Viewing
            </Label>
            <Button size="small" leadingVisual={PencilIcon} onClick={onSwitchToEdit} data-testid="edit-workflow">
              Edit
            </Button>
          </>
        ) : (
          <Button size="small" onClick={save} disabled={saving} data-testid="save-workflow">
            {saving ? 'Saving…' : workflow ? 'Save changes' : 'Save workflow'}
          </Button>
        )}
        {/* Run is the canvas's one primary action once a workflow is
            saved (docs/SPEC.md §3.8) -- Save above is deliberately
            demoted off variant="primary" so the two don't compete.
            Works in both view and edit mode (docs/goals/0022). */}
        <RunButton ref={runButtonRef} workflow={workflow} onStartRun={onStartRun} />
      </Stack>
      {saveError && <Text as="p" size="small" className={runbookStyles.error}>{saveError}</Text>}
      {descOpen && (
        <FormControl className={styles.metaDescription}>
          <FormControl.Label>Description</FormControl.Label>
          <Textarea value={draftDescription} onChange={(e) => onDescriptionChange(e.target.value)} rows={2} block disabled={readOnly} />
        </FormControl>
      )}
    </div>
  )
}
