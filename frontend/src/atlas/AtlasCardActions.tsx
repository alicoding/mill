import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, FormControl, IconButton, Text } from '@primer/react'
import { XIcon } from '@primer/octicons-react'
import { AtlasService, CompositionService } from '../shared/bindings'
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
export function AtlasCardActions({ cardID, actionWorkflowIDs, onActionsChanged }: {
  cardID: string
  actionWorkflowIDs: string[]
  onActionsChanged: (next: string[]) => void
}) {
  const { t } = useTranslation('atlas')
  const [labels, setLabels] = useState<Map<string, string>>(new Map())
  const [adding, setAdding] = useState(false)
  const [runState, setRunState] = useState<Record<string, 'started' | 'error'>>({})

  useEffect(() => {
    void CompositionService.Workflows().then((ws) => {
      setLabels(new Map((ws ?? []).map((w) => [w.ID, w.Label])))
    }).catch(() => setLabels(new Map()))
  }, [])

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

  return (
    <FormControl>
      <FormControl.Label>{t('overlay.actionsLabel')}</FormControl.Label>
      <div className={styles.block} data-testid="atlas-page-actions">
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
        {adding ? (
          <EntityRefField refKind="workflow" value="" onChange={add} />
        ) : (
          <Button size="small" variant="invisible" data-testid="atlas-page-add-action" onClick={() => setAdding(true)}>
            {t('overlay.addAction')}
          </Button>
        )}
        <Text as="p" size="small" className={runbookStyles.muted}>{t('overlay.actionsHint')}</Text>
      </div>
    </FormControl>
  )
}
