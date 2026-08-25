import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Events } from '@wailsio/runtime'
import { Blankslate } from '@primer/react/experimental'
import { Button, Checkbox, FormControl, Heading, IconButton, Stack, Text } from '@primer/react'
import { KeyIcon, LockIcon, PlusIcon } from '@primer/octicons-react'
import { SecretService } from '../shared/bindings'
import type { SecretSummary, VaultStatus } from '../shared/bindings'
import { InventoryList, type InventoryItem } from '../shared/InventoryList'
import { ENTITY_ICON } from '../shared/entityIcons'
import { formatUpdated, sortByUpdatedDesc } from '../shared/inventorySort'
import { useConfirmDelete } from '../shared/useConfirmDelete'
import PageContainer from '../shared/PageContainer'
import { SecretsEntryDialog } from './SecretsEntryDialog'
import { SecretsDetailDialog } from './SecretsDetailDialog'
import { SecretsHistoryDialog } from './SecretsHistoryDialog'
import styles from './SecretsView.module.css'

// The secret manager's human-facing surface (goal 0185 S2): browse,
// reveal/hide, copy with auto-clear, add/edit/delete, history --
// resolution into workflows/MCP servers is a separate, later consumer
// of the same vault (S3), not rendered here at all. Deliberately its
// own top-level page, not nested in Configure (the domain package's own
// doc comment has the full reasoning).
export default function SecretsView() {
  const { t } = useTranslation('secrets')
  const [status, setStatus] = useState<VaultStatus | null>(null)
  const [list, setList] = useState<SecretSummary[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [presenceBusy, setPresenceBusy] = useState(false)
  const [error, setError] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [editingID, setEditingID] = useState<string | null>(null)
  const [detailID, setDetailID] = useState<string | null>(null)
  const [historyID, setHistoryID] = useState<string | null>(null)

  const refresh = () => {
    SecretService.VaultStatus().then((s) => {
      setStatus(s)
      if (s.Unlocked) {
        SecretService.ListSecrets().then(setList).catch((err) => setError(String(err)))
      } else {
        setList(null)
      }
    }).catch((err) => setError(String(err)))
  }

  useEffect(() => {
    refresh()
    return Events.On('mill-data-changed', (evt) => {
      const entity = (evt.data as { entity?: string })?.entity
      if (entity === 'secret') refresh()
    })
  }, [])

  const setupVault = () => {
    setBusy(true)
    setError('')
    SecretService.SetupVault().then(refresh).catch((err) => setError(String(err))).finally(() => setBusy(false))
  }

  const unlockVault = () => {
    setBusy(true)
    setError('')
    SecretService.UnlockVault().then(refresh).catch((err) => setError(String(err))).finally(() => setBusy(false))
  }

  const lockVault = () => {
    setError('')
    SecretService.LockVault().then(refresh).catch((err) => setError(String(err)))
  }

  const toggleTouchID = (enabled: boolean) => {
    setPresenceBusy(true)
    setError('')
    SecretService.SetTouchIDProtection(enabled).then(refresh).catch((err) => setError(String(err))).finally(() => setPresenceBusy(false))
  }

  const startCreate = () => {
    setEditingID(null)
    setFormOpen(true)
  }

  const startEdit = (id: string) => {
    setDetailID(null)
    setEditingID(id)
    setFormOpen(true)
  }

  const remove = (id: string) => {
    SecretService.DeleteSecret(id).then(() => { setDetailID(null); refresh() }).catch((err) => setError(String(err)))
  }

  const { requestDelete, dialog: confirmDialog } = useConfirmDelete<SecretSummary>({
    entityType: 'secret',
    labelOf: (s) => s.Title,
    onConfirm: (s) => remove(s.ID),
  })

  if (status === null) return null

  if (!status.Exists) {
    return (
      <PageContainer variant="wide" data-testid="secrets-view">
        <Blankslate>
          <Blankslate.Visual><KeyIcon size={32} /></Blankslate.Visual>
          <Blankslate.Heading>{t('setup.heading')}</Blankslate.Heading>
          <Blankslate.Description>{t('setup.description')}</Blankslate.Description>
          <Button variant="primary" onClick={setupVault} disabled={busy} data-testid="secrets-setup-cta">
            {t('setup.cta')}
          </Button>
          {error && <Text as="p" size="small" className={styles.error}>{error}</Text>}
        </Blankslate>
      </PageContainer>
    )
  }

  const protectionStatus = status.PresenceProtected ? t('touchId.protectedStatus') : t('touchId.keychainStatus')

  if (!status.Unlocked) {
    return (
      <PageContainer variant="wide" data-testid="secrets-view">
        <Blankslate>
          <Blankslate.Visual><LockIcon size={32} /></Blankslate.Visual>
          <Blankslate.Heading>{t('locked.heading')}</Blankslate.Heading>
          <Blankslate.Description>{t('locked.description')}</Blankslate.Description>
          <Text as="p" size="small" className={styles.subtitle} data-testid="secrets-protection-status">{protectionStatus}</Text>
          <Button variant="primary" onClick={unlockVault} disabled={busy} data-testid="secrets-unlock-cta">
            {t('locked.cta')}
          </Button>
          {error && <Text as="p" size="small" className={styles.error} data-testid="secrets-unlock-error">{error}</Text>}
        </Blankslate>
      </PageContainer>
    )
  }

  const sorted = sortByUpdatedDesc(list ?? [], (s) => s.UpdatedAt)
  const items: InventoryItem[] = sorted.map((s) => ({
    id: s.ID,
    entity: 'secret',
    icon: ENTITY_ICON.secret,
    label: s.Title,
    description: s.Username || s.URL || undefined,
    updatedLabel: formatUpdated(s.UpdatedAt),
    onOpen: () => setDetailID(s.ID),
    menuActions: [
      { label: t('editButton'), onClick: () => startEdit(s.ID) },
      { label: t('historyButton'), onClick: () => setHistoryID(s.ID) },
      {
        label: t('deleteButton'),
        onClick: () => remove(s.ID),
        danger: true,
        confirm: { title: t('deleteConfirmTitle'), body: t('deleteConfirmBody', { label: s.Title }) },
      },
    ],
  }))

  return (
    <PageContainer variant="wide" data-testid="secrets-view">
      <Stack direction="horizontal" justify="space-between" align="center" className={styles.header}>
        <Stack direction="vertical" gap="none">
          <Heading as="h1" id="secrets-heading">{t('heading')}</Heading>
          <Text as="p" size="small" className={styles.subtitle}>{t('subtitle')}</Text>
        </Stack>
        <Stack direction="horizontal" gap="condensed" align="center">
          <IconButton icon={LockIcon} aria-label={t('lockButton')} variant="invisible" onClick={lockVault} data-testid="secrets-lock" />
          <Button leadingVisual={PlusIcon} variant="primary" onClick={startCreate} data-testid="secrets-new">
            {t('newSecret')}
          </Button>
        </Stack>
      </Stack>
      <Stack direction="horizontal" justify="space-between" align="center" className={styles.protectionRow}>
        <Text as="p" size="small" className={styles.subtitle} data-testid="secrets-protection-status">{protectionStatus}</Text>
        <FormControl>
          <Checkbox
            checked={status.PresenceProtected}
            disabled={presenceBusy}
            onChange={(e) => toggleTouchID(e.target.checked)}
            data-testid="secrets-touchid-toggle"
          />
          <FormControl.Label>{t('touchId.toggleLabel')}</FormControl.Label>
          <FormControl.Caption>{t('touchId.toggleCaption')}</FormControl.Caption>
        </FormControl>
      </Stack>
      {error && <Text as="p" size="small" className={styles.error} data-testid="secrets-touchid-error">{error}</Text>}
      <InventoryList
        items={items}
        searchPlaceholder={t('searchPlaceholder')}
        emptyState={{
          icon: KeyIcon,
          heading: t('emptyHeading'),
          description: t('emptyDescription'),
          action: <Button leadingVisual={PlusIcon} variant="primary" onClick={startCreate}>{t('newSecret')}</Button>,
        }}
      />
      {formOpen && (
        <SecretsEntryDialog
          editID={editingID}
          onClose={() => setFormOpen(false)}
          onSaved={() => { setFormOpen(false); refresh() }}
        />
      )}
      {detailID && (
        <SecretsDetailDialog
          id={detailID}
          onClose={() => setDetailID(null)}
          onEdit={() => startEdit(detailID)}
          onHistory={() => setHistoryID(detailID)}
          onDelete={() => requestDelete(sorted.find((s) => s.ID === detailID) ?? { ID: detailID, Title: detailID, Username: '', URL: '', Tags: '', UpdatedAt: '' })}
        />
      )}
      {historyID && <SecretsHistoryDialog id={historyID} onClose={() => setHistoryID(null)} />}
      {confirmDialog}
    </PageContainer>
  )
}
