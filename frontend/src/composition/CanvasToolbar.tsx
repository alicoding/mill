import { Panel } from '@xyflow/react'
import { useTranslation } from 'react-i18next'
import { Button, IconButton, Stack, Text } from '@primer/react'
import { ArrowLeftIcon, ColumnsIcon, CommentIcon, PlusIcon, RedoIcon, TrashIcon, UndoIcon } from '@primer/octicons-react'
import type { Issue } from '../../bindings/github.com/alicoding/mill/internal/domain/composition/models'
import { ValidationSurface } from './ValidationPanel'
import styles from './CompositionCanvas.module.css'
import runbookStyles from '../shared/ListCard.module.css'

interface CanvasToolbarProps {
  onBack: () => void
  // The run monitor has no "back": its window's close is the way out.
  hideBack?: boolean
  // docs/goals/0022-workflow-view-mode.md: authoring-only controls
  // (palette toggle, undo/redo, auto-layout, delete-selected) are
  // absent entirely in view mode, not just disabled -- the goal's own
  // "NO palette toggle, NO delete/undo/redo toolbar buttons" acceptance
  // bullet. Back and the validation summary stay in both modes:
  // leaving the canvas and reading validation issues are never edits.
  readOnly: boolean
  paletteOpen: boolean
  onTogglePalette: () => void
  canUndo: boolean
  onUndo: () => void
  canRedo: boolean
  onRedo: () => void
  layingOut: boolean
  hasNodes: boolean
  onAutoLayout: () => void
  onDeleteSelected: () => void
  // Adds a canvas note near the viewport's center (docs/goals/0055) --
  // authoring-space annotation, not a step, so it lives on this
  // toolbar rather than the step palette.
  onAddNote: () => void
  validationIssues: Issue[]
  workflowLabel: string
  workflowId: string
  onSelectIssue: (issue: Issue) => void
}

// The canvas's top-left React Flow Panel -- split out of
// CompositionCanvas.tsx once view mode (docs/goals/0022) pushed that
// file back over the 500-line limit (CLAUDE.md), the same "split along
// a real seam" discipline CanvasMetaHeader/NodePalette already
// established.
export function CanvasToolbar({
  onBack, hideBack, readOnly, paletteOpen, onTogglePalette, canUndo, onUndo, canRedo, onRedo,
  layingOut, hasNodes, onAutoLayout, onDeleteSelected, onAddNote, validationIssues, workflowLabel, workflowId, onSelectIssue,
}: CanvasToolbarProps) {
  const { t } = useTranslation('composition')
  return (
    <Panel position="top-left" className={styles.canvasToolbar}>
      <Stack direction="horizontal" gap="condensed" align="center">
        {!hideBack && <IconButton icon={ArrowLeftIcon} aria-label={t('canvasToolbar.backAriaLabel')} size="small" onClick={onBack} />}
        {!readOnly && (
          <>
            <Button
              size="small"
              leadingVisual={PlusIcon}
              aria-expanded={paletteOpen}
              onClick={onTogglePalette}
              data-testid="toggle-palette"
            >
              {t('canvasToolbar.addStep')}
            </Button>
            <IconButton icon={UndoIcon} aria-label={t('canvasToolbar.undoAriaLabel')} size="small" disabled={!canUndo} onClick={onUndo} />
            <IconButton icon={RedoIcon} aria-label={t('canvasToolbar.redoAriaLabel')} size="small" disabled={!canRedo} onClick={onRedo} />
            <IconButton icon={ColumnsIcon} aria-label={t('canvasToolbar.autoLayoutAriaLabel')} size="small" disabled={layingOut || !hasNodes} onClick={onAutoLayout} />
            <IconButton icon={TrashIcon} aria-label={t('canvasToolbar.deleteSelectedAriaLabel')} size="small" onClick={onDeleteSelected} />
            <IconButton icon={CommentIcon} aria-label={t('canvasToolbar.addNoteAriaLabel')} size="small" onClick={onAddNote} data-testid="add-note" />
          </>
        )}
        <ValidationSurface issues={validationIssues} workflowLabel={workflowLabel} workflowId={workflowId} onSelectIssue={onSelectIssue} />
        {!readOnly && (
          <Text size="small" className={`${runbookStyles.muted} ${styles.canvasToolbarHint}`} title={t('canvasToolbar.addStepsHint')}>
            {t('canvasToolbar.addStepsHint')}
          </Text>
        )}
      </Stack>
    </Panel>
  )
}
