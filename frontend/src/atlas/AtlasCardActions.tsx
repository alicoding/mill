import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Events } from '@wailsio/runtime'
import { Button, IconButton, Text } from '@primer/react'
import { XIcon } from '@primer/octicons-react'
import { AtlasService, CompositionService } from '../shared/bindings'
import type { CardSourceOffer } from '../../bindings/github.com/alicoding/mill/internal/services/atlassvc/models'
import { EntityRefField } from '../configure/EntityRefField'
import { nextActionsOnAdd, nextActionsOnRemove } from './atlasCardActionOps'
import runbookStyles from '../shared/ListCard.module.css'
import styles from './AtlasCardActions.module.css'

// The card's Actions block (goal 0084): one or more callable
// workflows attached to THIS card, each runnable from here -- the
// generalization that replaced the single bespoke refresh-workflow
// select. Every action receives the card's identity through the same
// declared-Attributes convention trigger-atlas-card fires with
// (cardId/kindId/cardTitle, changeType "action"); the hint line makes
// that contract visible instead of implicit.
//
// Collapses to its bare add row when empty (goal 0106 slice B contract
// item 3): zero actions means no heading, no hint text, just the one
// "+ Add action" invitation; the heading/hint return the instant a
// first action exists. This is a LIVE condition on actionWorkflowIDs
// itself, not a one-time click-to-reveal state -- removing the last
// action collapses the block back down immediately, unlike the other
// page fields' sticky-once-expanded behavior (AtlasCardPageFields.tsx),
// since there's no "value that would be lost" here to preserve
// visibility for.
export function AtlasCardActions({ cardID, actionWorkflowIDs, onActionsChanged }: {
  cardID: string
  actionWorkflowIDs: string[]
  onActionsChanged: (next: string[]) => void
}) {
  const { t } = useTranslation('atlas')
  const [labels, setLabels] = useState<Map<string, string>>(new Map())
  const [adding, setAdding] = useState(false)
  const [runState, setRunState] = useState<Record<string, 'started' | 'error'>>({})
  // Recognized-source offers (goal 0126): workflows declaring this
  // card's matched Integration, runnable here without prior attachment.
  const [offer, setOffer] = useState<CardSourceOffer | null>(null)

  useEffect(() => {
    void CompositionService.Workflows().then((ws) => {
      setLabels(new Map((ws ?? []).map((w) => [w.ID, w.Label])))
    }).catch(() => setLabels(new Map()))
  }, [])

  // Fetched on mount and re-fetched on every persisted atlas change --
  // the draft source value is NOT a valid trigger (a refetch keyed on
  // typing races the commit and reads the pre-save card); the
  // mill-data-changed emit fires only after persistence.
  useEffect(() => {
    const refetch = () => void AtlasService.CardSourceOffer(cardID).then(setOffer).catch(() => setOffer(null))
    refetch()
    return Events.On('mill-data-changed', (evt) => {
      if ((evt.data as { entity?: string })?.entity === 'atlas') refetch()
    })
  }, [cardID])

  const run = (workflowID: string) => {
    setRunState((prev) => ({ ...prev, [workflowID]: undefined as never }))
    AtlasService.RunCardAction(cardID, workflowID)
      .then(() => setRunState((prev) => ({ ...prev, [workflowID]: 'started' })))
      .catch(() => setRunState((prev) => ({ ...prev, [workflowID]: 'error' })))
  }

  const remove = (workflowID: string) => {
    const next = nextActionsOnRemove(actionWorkflowIDs, workflowID)
    if (next !== actionWorkflowIDs) onActionsChanged(next)
  }

  const add = (workflowID: string) => {
    setAdding(false)
    const next = nextActionsOnAdd(actionWorkflowIDs, workflowID)
    if (next !== actionWorkflowIDs) onActionsChanged(next)
  }

  const hasActions = actionWorkflowIDs.length > 0
  // Already-attached workflows never render twice; running an offered
  // one attaches it (its row moves up into the attached list, run
  // status intact since runState is keyed by workflow id).
  const offered = (offer?.Workflows ?? []).filter((w) => !actionWorkflowIDs.includes(w.WorkflowID))
  const runOffered = (workflowID: string) => {
    run(workflowID)
    onActionsChanged(nextActionsOnAdd(actionWorkflowIDs, workflowID))
  }

  return (
    <div className={styles.block} data-testid="atlas-page-actions">
      {hasActions && <Text as="p" weight="semibold" size="small">{t('overlay.actionsLabel')}</Text>}
      {actionWorkflowIDs.map((id) => (
        <div key={id} className={styles.row} data-testid="atlas-page-action-row">
          <Text className={styles.rowLabel}>{labels.get(id) ?? id}</Text>
          {runState[id] === 'started' && <Text size="small" className={runbookStyles.muted} data-testid="atlas-page-action-started">{t('overlay.runStarted')}</Text>}
          {runState[id] === 'error' && <Text size="small" className={runbookStyles.error}>{t('overlay.actionRunError')}</Text>}
          <Button size="small" data-testid="atlas-page-run-action" onClick={() => run(id)}>
            {t('overlay.runAction')}
          </Button>
          <IconButton size="small" variant="invisible" icon={XIcon} aria-label={t('overlay.removeAction')} onClick={() => remove(id)} />
        </div>
      ))}
      {offer?.Recognized && offered.length > 0 && (
        <div data-testid="atlas-page-offers">
          <Text as="p" weight="semibold" size="small">{t('offers.heading', { label: offer.Label })}</Text>
          {offered.map((w) => (
            <div key={w.WorkflowID} className={styles.row} data-testid="atlas-page-offer-row">
              <Text className={styles.rowLabel}>{w.Label}</Text>
              <Button size="small" data-testid="atlas-page-run-offer" onClick={() => runOffered(w.WorkflowID)}>
                {t('overlay.runAction')}
              </Button>
            </div>
          ))}
          <Text as="p" size="small" className={runbookStyles.muted}>{t('offers.hint')}</Text>
        </div>
      )}
      {adding ? (
        <EntityRefField refKind="workflow" value="" onChange={add} />
      ) : (
        <Button size="small" variant="invisible" className={styles.quietAdd} data-testid="atlas-page-add-action" onClick={() => setAdding(true)}>
          {t('overlay.addAction')}
        </Button>
      )}
      {hasActions && <Text as="p" size="small" className={runbookStyles.muted}>{t('overlay.actionsHint')}</Text>}
    </div>
  )
}
