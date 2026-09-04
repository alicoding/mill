import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, IconButton, Stack, Text } from '@primer/react'
import { CheckIcon, CopyIcon, PinIcon, PinSlashIcon, TrashIcon } from '@primer/octicons-react'
import { ClipboardHistoryService, type ClipboardHistoryEntry } from '../shared/bindings'
import { background } from '../shared/background'
import { looksLikeCode } from './looksLikeCode'
import styles from './ClipboardHistoryDialog.module.css'

// ClipboardHistoryDetail renders the currently-selected entry's full
// content plus its Copy/Pin/Delete actions -- split out of
// ClipboardHistoryDialog.tsx to keep each component's own cognitive
// complexity under the repo's gate (.claude/rules/testing.md).
export function ClipboardHistoryDetail({ entry, onChanged }: { entry: ClipboardHistoryEntry | null; onChanged: () => void }) {
  const { t } = useTranslation('app')
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [copyError, setCopyError] = useState<string | null>(null)

  if (!entry) {
    return (
      <Text size="small" className={styles.noSelection}>
        {t('clipboardHistory.noSelection')}
      </Text>
    )
  }

  const doCopy = () => {
    setCopyError(null)
    ClipboardHistoryService.CopyClipboardHistoryEntry(entry.ID)
      .then(() => {
        setCopiedId(entry.ID)
        window.setTimeout(() => setCopiedId((current) => (current === entry.ID ? null : current)), 1500)
      })
      // A copy can fail environment-side (no pasteboard session) --
      // shown, never swallowed, same posture Secrets' own copy action
      // takes (SecretsDetailDialog.tsx's secret-detail-error testid).
      .catch((err: unknown) => setCopyError(String(err)))
  }
  // Pin/delete stay background() calls: goal 0335 confirmed neither
  // has a static registry command to route through -- both act on
  // this specific entry.ID, and the Command shape (shared/commands.ts)
  // carries no argument for run() to receive it through.
  const doPin = () => {
    void background(ClipboardHistoryService.SetClipboardHistoryPinned(entry.ID, !entry.Pinned).then(onChanged), 'clipboardHistory.pin')
  }
  const doDelete = () => {
    void background(ClipboardHistoryService.DeleteClipboardHistoryEntry(entry.ID).then(onChanged), 'clipboardHistory.delete')
  }

  const copied = copiedId === entry.ID

  return (
    <>
      <pre className={`${styles.preview} ${looksLikeCode(entry.Text) ? styles.previewMono : ''}`} data-testid="clipboard-history-detail-text">
        {entry.Text}
      </pre>
      <Stack direction="horizontal" gap="condensed" className={styles.actions}>
        <Button variant="primary" size="small" leadingVisual={copied ? CheckIcon : CopyIcon} onClick={doCopy} data-testid="clipboard-history-copy">
          {copied ? t('clipboardHistory.copied') : t('clipboardHistory.copy')}
        </Button>
        <Button
          size="small"
          leadingVisual={entry.Pinned ? PinSlashIcon : PinIcon}
          onClick={doPin}
          data-testid="clipboard-history-pin"
        >
          {entry.Pinned ? t('clipboardHistory.unpin') : t('clipboardHistory.pin')}
        </Button>
        <IconButton
          icon={TrashIcon}
          variant="danger"
          aria-label={t('clipboardHistory.delete')}
          size="small"
          onClick={doDelete}
          data-testid="clipboard-history-delete"
        />
      </Stack>
      {copyError && (
        <Text size="small" className={styles.copyError} data-testid="clipboard-history-copy-error">
          {copyError}
        </Text>
      )}
    </>
  )
}
