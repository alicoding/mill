import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, IconButton, Stack, Text } from '@primer/react'
import { CheckIcon, CopyIcon, PinIcon, PinSlashIcon, TrashIcon } from '@primer/octicons-react'
import { ClipboardHistoryService, type ClipboardHistoryEntry } from '../shared/bindings'
import { runCommand } from '../shared/commands'
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
  // Pin/unpin/delete are registry commands with this entry as their
  // target (goal 0343). Pin and Unpin are separate commands whose
  // enablement reads the context's own `pinned`, so the button renders
  // whichever one can actually run.
  const ctx = { kind: 'entry' as const, entryId: entry.ID, pinned: entry.Pinned }
  const doPin = () => {
    void runCommand(entry.Pinned ? 'clipboard.unpin' : 'clipboard.pin', ctx).then(onChanged)
  }
  const doDelete = () => {
    void runCommand('clipboard.delete', ctx).then(onChanged)
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
