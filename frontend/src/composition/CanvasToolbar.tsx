import { Panel } from '@xyflow/react'
import { IconButton, Stack, Text } from '@primer/react'
import { ArrowLeftIcon, ColumnsIcon, RedoIcon, SidebarCollapseIcon, SidebarExpandIcon, TrashIcon, UndoIcon } from '@primer/octicons-react'
import type { Issue } from '../../bindings/github.com/alicoding/mill/internal/domain/composition/models'
import { ValidationSurface } from './ValidationPanel'
import styles from './CompositionCanvas.module.css'
import runbookStyles from '../shared/ListCard.module.css'

interface CanvasToolbarProps {
  onBack: () => void
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
  onBack, readOnly, paletteOpen, onTogglePalette, canUndo, onUndo, canRedo, onRedo,
  layingOut, hasNodes, onAutoLayout, onDeleteSelected, validationIssues, workflowLabel, workflowId, onSelectIssue,
}: CanvasToolbarProps) {
  return (
    <Panel position="top-left" className={styles.canvasToolbar}>
      <Stack direction="horizontal" gap="condensed" align="center">
        <IconButton icon={ArrowLeftIcon} aria-label="Back to workflows" size="small" onClick={onBack} />
        {!readOnly && (
          <>
            <IconButton
              icon={paletteOpen ? SidebarCollapseIcon : SidebarExpandIcon}
              aria-label={paletteOpen ? 'Hide add steps panel' : 'Add steps'}
              size="small"
              onClick={onTogglePalette}
              data-testid="toggle-palette"
            />
            <IconButton icon={UndoIcon} aria-label="Undo" size="small" disabled={!canUndo} onClick={onUndo} />
            <IconButton icon={RedoIcon} aria-label="Redo" size="small" disabled={!canRedo} onClick={onRedo} />
            <IconButton icon={ColumnsIcon} aria-label="Auto-layout" size="small" disabled={layingOut || !hasNodes} onClick={onAutoLayout} />
            <IconButton icon={TrashIcon} aria-label="Delete selected" size="small" onClick={onDeleteSelected} />
          </>
        )}
        <ValidationSurface issues={validationIssues} workflowLabel={workflowLabel} workflowId={workflowId} onSelectIssue={onSelectIssue} />
        {!readOnly && (
          <Text size="small" className={runbookStyles.muted}>
            Add steps to drag a node type onto the canvas, connect them, click a node to configure it.
          </Text>
        )}
      </Stack>
    </Panel>
  )
}
