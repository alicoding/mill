import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Banner, Button, IconButton, Select, Stack, Text, Textarea } from '@primer/react'
import { Blankslate } from '@primer/react/experimental'
import { SparkleFillIcon, XIcon } from '@primer/octicons-react'
import { useAppStore } from '../shared/store'
import { useUISignalStore } from '../shared/uiSignalStore'
import { useCompanionChat } from './useCompanionChat'
import { CompanionProposal } from './CompanionProposal'
import styles from './CompanionPanel.module.css'

// The Atlas AI companion panel (goal 0101 slice 1): a right-side panel
// over the board, ~360px, mirroring the composition view's inspector-
// panel shape. Kept under frontend/src/atlas/ for now -- a single
// consumer -- but its props API stays view-agnostic (a viewedID scope
// in, nothing view-specific out) so a second consumer (a workflow-
// canvas or runs-view companion) can promote it to shared/ later
// without rework.
export function CompanionPanel({ viewedID }: { viewedID: string }) {
  const { t } = useTranslation('atlas')
  const open = useUISignalStore((s) => s.companionOpen)
  const close = useUISignalStore((s) => s.closeCompanion)
  const chat = useCompanionChat(viewedID)
  const setView = useAppStore((s) => s.setView)
  const [draft, setDraft] = useState('')
  const transcriptRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, close])

  useEffect(() => {
    transcriptRef.current?.scrollTo({ top: transcriptRef.current.scrollHeight })
  }, [chat.entries, chat.streamingText])

  if (!open) return null

  const send = () => {
    if (!draft.trim()) return
    chat.sendMessage(draft)
    setDraft('')
  }

  const providers = chat.providers ?? []

  return (
    <div className={styles.panel} data-testid="companion-panel">
      <Stack direction="horizontal" className={styles.header} justify="space-between">
        {providers.length > 0 ? (
          <Select
            aria-label={t('companionPanel.providerLabel')}
            value={chat.providerID}
            onChange={(e) => chat.setProviderID(e.target.value)}
            data-testid="companion-provider-select"
          >
            {providers.map((p) => <Select.Option key={p.ID} value={p.ID}>{p.Label}</Select.Option>)}
          </Select>
        ) : (
          <Text weight="semibold">{t('companionPanel.toggleButton')}</Text>
        )}
        <IconButton icon={XIcon} size="small" variant="invisible" aria-label={t('companionPanel.close')} onClick={close} data-testid="companion-close" />
      </Stack>

      <div className={styles.transcript} ref={transcriptRef} data-testid="companion-transcript">
        {chat.providers !== null && providers.length === 0 && (
          <Blankslate data-testid="companion-provider-empty">
            <Blankslate.Visual><SparkleFillIcon size={24} /></Blankslate.Visual>
            <Blankslate.Heading>{t('companionPanel.providerEmptyHeading')}</Blankslate.Heading>
            <Blankslate.PrimaryAction onClick={() => setView({ kind: 'configure', tab: 'aiproviders' })}>
              {t('companionPanel.providerEmptyAction')}
            </Blankslate.PrimaryAction>
          </Blankslate>
        )}
        {providers.length > 0 && chat.entries.length === 0 && !chat.busy && (
          <Text size="small" className={styles.emptyHint}>{t('companionPanel.emptyTranscript')}</Text>
        )}
        {chat.entries.map((entry) => (
          <div key={entry.id} className={entry.role === 'user' ? styles.userBubble : styles.assistantBubble} data-testid={`companion-entry-${entry.role}`}>
            <Text>{entry.content}</Text>
            {entry.role === 'assistant' && entry.preview?.Recognized && entry.preview.Valid && (
              <CompanionProposal
                preview={entry.preview}
                accepted={!!entry.accepted}
                busy={chat.busy}
                onAccept={(accepted) => void chat.acceptProposal(entry.id, accepted)}
              />
            )}
            {entry.role === 'assistant' && entry.preview?.Recognized && !entry.preview.Valid && (
              <Text size="small" className={styles.notActionsNote} data-testid="companion-not-actions">{t('companionPanel.notActions')}</Text>
            )}
          </div>
        ))}
        {chat.busy && (
          <div className={styles.assistantBubble} data-testid="companion-streaming">
            <Text>{chat.streamingText}</Text>
          </div>
        )}
        {chat.error && (
          <Banner
            variant="critical"
            title={t('companionPanel.errorTitle')}
            description={chat.error}
            primaryAction={<Button size="small" onClick={chat.retry}>{t('companionPanel.retry')}</Button>}
          />
        )}
      </div>

      <Stack className={styles.composer} gap="condensed">
        <Textarea
          placeholder={t('companionPanel.composerPlaceholder')}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
              e.preventDefault()
              send()
            }
          }}
          disabled={providers.length === 0}
          rows={2}
          resize="vertical"
          data-testid="companion-composer"
        />
        <Button variant="primary" onClick={send} disabled={chat.busy || !draft.trim() || providers.length === 0} data-testid="companion-send">
          {t('companionPanel.send')}
        </Button>
      </Stack>
    </div>
  )
}
