import { useEffect, useState, type Ref } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, FormControl, IconButton, SegmentedControl, Stack, Text, TextInput, Textarea } from '@primer/react'
import { ChevronDownIcon, ChevronUpIcon, EyeIcon, PencilIcon } from '@primer/octicons-react'
import type { Workflow } from '../../bindings/github.com/alicoding/mill/internal/domain/composition/models'
import { CompositionService } from '../shared/bindings'
import { WorkflowEnvironmentField } from './WorkflowEnvironmentField'
import { WorkflowOfferField } from './WorkflowOfferField'
import { RunButton, type RunButtonHandle } from './LiveRunControls'
import { runCommand } from '../shared/commands'
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
  // Viewing renders the title, description and offer field read-only
  // and hides Save; the mode switch beside them is present in BOTH
  // modes, so the canvas always says which one it is in.
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
  // The default environment (goal 0306 S5) commits on pick for the same
  // reason the offer does: workflow metadata with its own setter, not
  // part of the graph's Save.
  const [environmentValue, setEnvironmentValue] = useState(workflow?.DefaultEnvironmentID ?? '')
  const [environmentError, setEnvironmentError] = useState('')
  useEffect(() => {
    setEnvironmentValue(workflow?.DefaultEnvironmentID ?? '')
    setEnvironmentError('')
  }, [workflow?.ID, workflow?.DefaultEnvironmentID])
  const commitEnvironment = (environmentID: string) => {
    if (!workflow) return
    setEnvironmentValue(environmentID)
    setEnvironmentError('')
    CompositionService.SetWorkflowDefaultEnvironment(workflow.ID, environmentID).catch((err) => setEnvironmentError(String(err)))
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
        {/* ONE control, present in both modes: the mode a canvas is in
            is never inferred from which buttons happen to be missing.
            The selected segment IS the current mode, and choosing the
            other one runs its command -- onSwitchToEdit stays the
            fallback for a canvas mounted outside a work tab (the run
            monitor window), where no tab exists for the command to
            switch. Labels collapse to their icons at companion widths. */}
        <SegmentedControl
          aria-label={t('canvasMetaHeader.modeAriaLabel')}
          size="small"
          variant={{ narrow: 'hideLabels', regular: 'default', wide: 'default' }}
          onChange={(index) => {
            const wantView = index === 0
            if (wantView === readOnly) return
            void runCommand(wantView ? 'workflow.view' : 'workflow.edit').then((ran) => {
              // A canvas mounted outside a work tab (the run monitor
              // window) has no tab for the command to switch, so the
              // command reports it did nothing and the prop-supplied
              // in-place switch takes over.
              if (!ran && !wantView) onSwitchToEdit?.()
            })
          }}
        >
          <SegmentedControl.Button selected={readOnly} leadingVisual={EyeIcon} data-testid="view-workflow">
            {t('canvasMetaHeader.viewing')}
          </SegmentedControl.Button>
          <SegmentedControl.Button selected={!readOnly} leadingVisual={PencilIcon} data-testid="edit-workflow">
            {t('canvasMetaHeader.editing')}
          </SegmentedControl.Button>
        </SegmentedControl>
        {!readOnly && (
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
                <WorkflowOfferField value={offerValue} onChange={commitOffer} readOnly={readOnly} />
              </FormControl>
              {offerError && <Text as="p" size="small" className={runbookStyles.error}>{offerError}</Text>}
              <FormControl>
                <FormControl.Label>{t('canvasMetaHeader.environmentLabel')}</FormControl.Label>
                <FormControl.Caption>{t('canvasMetaHeader.environmentCaption')}</FormControl.Caption>
                <WorkflowEnvironmentField value={environmentValue} onChange={commitEnvironment} readOnly={readOnly} />
              </FormControl>
              {environmentError && <Text as="p" size="small" className={runbookStyles.error}>{environmentError}</Text>}
            </fieldset>
          )}
        </Stack>
      )}
    </div>
  )
}
