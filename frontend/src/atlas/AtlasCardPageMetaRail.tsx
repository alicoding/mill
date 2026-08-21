import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Checkbox, FormControl, Label, Link as PrimerLink, Stack } from '@primer/react'
import { AtlasService } from '../shared/bindings'
import { CheckIcon, CopyIcon, LinkIcon, SyncIcon } from '@primer/octicons-react'
import type { Card } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { formatUpdated } from '../shared/inventorySort'
import { runStatusVariant } from '../shared/runTime'
import { StatusStamp } from '../shared/StatusStamp'
import { basenameOf, hostnameOf } from './atlasCardPresentation'
import { Browser } from '@wailsio/runtime'
import { normalizeExternalURL } from '../shared/externalUrl'
import styles from './AtlasCardPage.module.css'

// The page's own meta rail (goal 0072 slice C): stacked mono rows,
// each omitted entirely when it has no value to show rather than
// rendered empty. Every action here is an EXISTING overlay capability
// relocated -- Update now, the receipt-run link, and the share actions
// keep their original test ids/copy so the specs that already assert
// against them (atlas.spec.ts, atlas-share.spec.ts) need no change.
// Reveal-file is deliberately NOT here (goal 0081 slice A5 rider (a)):
// the header's kebab menu is the one source for Open file/Reveal now,
// matching the canvas card menu -- this row used to duplicate it.
export function AtlasCardPageMetaRail({
  card, updating, onUpdateNow, receiptStatus, onOpenRun,
  includeAttachments, onIncludeAttachmentsChange, copied, onCopyContext, copiedAI, onCopyForAI, onCopyLink,
}: {
  card: Card
  updating: boolean
  onUpdateNow: () => void
  receiptStatus: string | null
  onOpenRun: () => void
  includeAttachments: boolean
  onIncludeAttachmentsChange: (checked: boolean) => void
  copied: boolean
  onCopyContext: () => void
  copiedAI: boolean
  onCopyForAI: () => void
  onCopyLink: () => void
}) {
  const { t } = useTranslation('atlas')
  const hasAction = (card.ActionWorkflowIDs?.length ?? 0) > 0
  const showFreshness = Boolean(hasAction || card.MirrorPath)
  // Recognition chip (goal 0126): a Source whose host matches a
  // configured Integration is named right beside the link.
  const [recognizedLabel, setRecognizedLabel] = useState('')
  useEffect(() => {
    if (!card.Source) {
      setRecognizedLabel('')
      return
    }
    void AtlasService.CardSourceOffer(card.ID)
      .then((offer) => setRecognizedLabel(offer.Recognized ? offer.Label : ''))
      .catch(() => setRecognizedLabel(''))
  }, [card.ID, card.Source])

  return (
    <div className={styles.metaCol} data-testid="atlas-page-meta-rail">
      {card.Source && (
        <div className={styles.metaRow} data-testid="atlas-page-meta-source">
          <span className={styles.metaLabel}>{t('page.metaSource')}</span>
          <a
            href={normalizeExternalURL(card.Source)}
            data-testid="atlas-overlay-source-link"
            className={styles.metaValue}
            onClick={(e) => {
              // The webview must NEVER navigate itself (a plain href
              // replaces the whole app with the site) -- the external
              // browser is the only legal destination, DocsView's own
              // pattern.
              e.preventDefault()
              void Browser.OpenURL(normalizeExternalURL(card.Source))
            }}
          >
            {hostnameOf(card.Source)}
          </a>
          {recognizedLabel && (
            <Label size="small" variant="secondary" title={t('page.sourceRecognizedTitle', { label: recognizedLabel })} data-testid="atlas-source-recognized">
              {recognizedLabel}
            </Label>
          )}
        </div>
      )}

      {card.MirrorPath && (
        <div className={styles.metaRow} data-testid="atlas-page-meta-mirror">
          <span className={styles.metaLabel}>{t('page.metaMirror')}</span>
          <span className={styles.metaValue}>{basenameOf(card.MirrorPath)}</span>
        </div>
      )}

      {showFreshness && (
        <div className={styles.metaRow} data-testid="atlas-page-meta-freshness">
          <span className={styles.metaLabel}>{t('page.metaFreshness')}</span>
          <span className={styles.metaValue}>
            {card.LastSyncedAt && formatUpdated(card.LastSyncedAt) ? t('overlay.lastSynced', { when: formatUpdated(card.LastSyncedAt) }) : t('overlay.neverSynced')}
          </span>
          {hasAction && (
            <Button
              leadingVisual={SyncIcon}
              size="small"
              variant="invisible"
              data-testid="atlas-overlay-update-now"
              disabled={updating}
              onClick={onUpdateNow}
            >
              {updating ? t('overlay.updating') : t('overlay.updateNow')}
            </Button>
          )}
        </div>
      )}

      <div className={styles.metaRow} data-testid="atlas-page-meta-share">
        <span className={styles.metaLabel}>{t('page.metaShare')}</span>
        <FormControl>
          <Checkbox
            checked={includeAttachments}
            data-testid="atlas-share-include-attachments"
            onChange={(e) => onIncludeAttachmentsChange(e.target.checked)}
          />
          <FormControl.Label>{t('overlay.includeAttachments')}</FormControl.Label>
        </FormControl>
        <Stack direction="horizontal" gap="condensed" className={styles.metaShareRow}>
          <PrimerLink as="button" type="button" data-testid="atlas-overlay-copy-context" onClick={onCopyContext}>
            {copied ? <CheckIcon size={12} /> : <CopyIcon size={12} />} {copied ? t('overlay.copied') : t('overlay.copyAsContext')}
          </PrimerLink>
          <PrimerLink as="button" type="button" data-testid="atlas-overlay-copy-for-ai" onClick={onCopyForAI}>
            {copiedAI ? <CheckIcon size={12} /> : <CopyIcon size={12} />} {copiedAI ? t('overlay.copied') : t('overlay.copyForAI')}
          </PrimerLink>
          {card.Source && (
            <PrimerLink as="button" type="button" data-testid="atlas-overlay-copy-link" onClick={onCopyLink}>
              <LinkIcon size={12} /> {t('overlay.copyCloudLink')}
            </PrimerLink>
          )}
        </Stack>
      </div>

      {card.ReceiptRunID && (
        <div className={styles.metaRow} data-testid="atlas-page-meta-receipt">
          <span className={styles.metaLabel}>{t('page.metaReceipt')}</span>
          <span className={styles.metaValue}>
            {t('overlay.receiptRunID')}{' '}
            <PrimerLink as="button" type="button" data-testid="atlas-overlay-receipt-run" onClick={onOpenRun}>
              {card.ReceiptRunID}
            </PrimerLink>
            {receiptStatus && (
              <>
                {' '}
                <StatusStamp variant={runStatusVariant(receiptStatus)} data-testid="atlas-overlay-receipt-status">{receiptStatus}</StatusStamp>
              </>
            )}
          </span>
        </div>
      )}
    </div>
  )
}
