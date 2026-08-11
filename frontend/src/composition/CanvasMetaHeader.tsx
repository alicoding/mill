import type { Ref } from 'react'
import { Button, FormControl, IconButton, Stack, Text, TextInput, Textarea } from '@primer/react'
import { ChevronDownIcon, ChevronUpIcon } from '@primer/octicons-react'
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
          className={styles.metaTitleInput}
        />
        <IconButton
          icon={descOpen ? ChevronUpIcon : ChevronDownIcon}
          aria-label={descOpen ? 'Hide details' : 'Add details'}
          size="small"
          onClick={onToggleDesc}
          data-testid="toggle-description"
        />
        <Button size="small" onClick={save} disabled={saving} data-testid="save-workflow">
          {saving ? 'Saving…' : workflow ? 'Save changes' : 'Save workflow'}
        </Button>
        {/* Run is the canvas's one primary action once a workflow is
            saved (docs/SPEC.md §3.8) -- Save above is deliberately
            demoted off variant="primary" so the two don't compete. */}
        <RunButton ref={runButtonRef} workflow={workflow} onStartRun={onStartRun} />
      </Stack>
      {saveError && <Text as="p" size="small" className={runbookStyles.error}>{saveError}</Text>}
      {descOpen && (
        <FormControl className={styles.metaDescription}>
          <FormControl.Label>Description</FormControl.Label>
          <Textarea value={draftDescription} onChange={(e) => onDescriptionChange(e.target.value)} rows={2} block />
        </FormControl>
      )}
    </div>
  )
}
