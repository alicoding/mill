import { useEffect, useState, type Ref } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, FormControl, IconButton, Label, Stack, Text, TextInput, Textarea } from '@primer/react'
import { ChevronDownIcon, ChevronUpIcon, EyeIcon, PencilIcon } from '@primer/octicons-react'
import type { Workflow } from '../../bindings/github.com/alicoding/mill/internal/domain/composition/models'
import { CompositionService } from '../shared/bindings'
import { EntityRefField } from '../configure/EntityRefField'
import { RunButton, type RunButtonHandle } from './LiveRunControls'
import { findCommand, runCommand } from '../shared/commands'
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
  const { t } = useTranslation('composition')
  // The offer declaration (goal 0126) commits on pick, independent of
  // the graph's Save -- it's workflow metadata with its own dedicated
  // setter, so this stays self-contained rather than threading through
  // CanvasInner's draft state.
  const [offerValue, setOfferValue] = useState(workflow?.OfferOnRequestID ?? '')
  const [offerError, setOfferError] = useState('')
  useEffect(() => {
    setOfferValue(workflow?.OfferOnRequestID ?? '')
    setOfferError('')
  }, [workflow?.ID, workflow?.OfferOnRequestID])
  const commitOffer = (requestID: string) => {
    if (!workflow) return
    setOfferValue(requestID)
    setOfferError('')
    CompositionService.SetWorkflowOffer(workflow.ID, requestID).catch((err) => setOfferError(String(err)))
  }
  return (
    <div className={styles.metaHeader}>
      <Stack direction="horizontal" gap="condensed" align="center">
        <TextInput
          value={draftLabel}
          onChange={(e) => onLabelChange(e.target.value)}
          aria-label={t('canvasMetaHeader.labelAriaLabel')}
          placeholder={t('canvasMetaHeader.labelPlaceholder')}
          size="small"
          disabled={readOnly}
          className={styles.metaTitleInput}
        />
        <IconButton
          icon={descOpen ? ChevronUpIcon : ChevronDownIcon}
          aria-label={descOpen ? t('canvasMetaHeader.hideDetails') : t('canvasMetaHeader.addDetails')}
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
              <EyeIcon size={12} /> {t('canvasMetaHeader.viewing')}
            </Label>
            <Button size="small" leadingVisual={PencilIcon} onClick={() => { const cmd = findCommand('workflow.edit'); if (cmd?.enabled?.()) void runCommand('workflow.edit'); else onSwitchToEdit?.() }} data-testid="edit-workflow">
              {t('canvasMetaHeader.edit')}
            </Button>
          </>
        ) : (
          <Button size="small" onClick={save} disabled={saving} data-testid="save-workflow">
            {saving ? t('canvasMetaHeader.saving') : workflow ? t('canvasMetaHeader.saveChanges') : t('canvasMetaHeader.saveWorkflow')}
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
        // One horizontal row, not stacked blocks: the collapsible's
        // height must not grow with the offer field -- the canvas
        // below loses that height, and canvas interactions are
        // geometry-sensitive (nodes pushed outside the viewport).
        <Stack direction="horizontal" gap="normal" align="start">
          <FormControl className={styles.metaDescription}>
            <FormControl.Label>{t('canvasMetaHeader.description')}</FormControl.Label>
            {readOnly ? (
              // Read-only shows the VALUE, never a disabled control (goal 0297).
              <Text as="p" size="small" className={runbookStyles.muted} style={{ margin: 0, whiteSpace: 'pre-wrap' }} data-testid="workflow-description-readonly">
                {draftDescription || t('canvasMetaHeader.noDescription')}
              </Text>
            ) : (
              <Textarea value={draftDescription} onChange={(e) => onDescriptionChange(e.target.value)} rows={2} block />
            )}
          </FormControl>
          {workflow && (
            // fieldset-disabled in view mode, the inspector's own
            // idiom -- EntityRefField has no disabled prop of its own.
            <fieldset disabled={readOnly} className={styles.metaOfferFieldset} data-testid="workflow-offer-field">
              <FormControl>
                <FormControl.Label>{t('canvasMetaHeader.offerLabel')}</FormControl.Label>
                <EntityRefField refKind="request" value={offerValue} onChange={commitOffer} readOnly={readOnly} />
                <FormControl.Caption>{t('canvasMetaHeader.offerCaption')}</FormControl.Caption>
              </FormControl>
              {offerError && <Text as="p" size="small" className={runbookStyles.error}>{offerError}</Text>}
            </fieldset>
          )}
        </Stack>
      )}
    </div>
  )
}
