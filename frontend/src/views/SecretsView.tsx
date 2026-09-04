import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Events } from '@wailsio/runtime'
import { Blankslate } from '@primer/react/experimental'
import { Button, Checkbox, FormControl, Heading, IconButton, Stack, Text } from '@primer/react'
import { HistoryIcon, KeyIcon, LockIcon, PlusIcon } from '@primer/octicons-react'
import { SecretService } from '../shared/bindings'
import type { SecretSummary } from '../shared/bindings'
import { findCommand, runCommand } from '../shared/commands'
import { refreshVaultStatus, useVaultStatusStore } from '../shared/vaultStatusStore'
import { vaultErrorKind } from '../shared/secretsCommands'
import { ConfirmDialog } from '../shared/ConfirmDialog'
import { InventoryList, type InventoryItem } from '../shared/InventoryList'
import { ENTITY_ICON } from '../shared/entityIcons'
import { formatUpdated, sortByUpdatedDesc } from '../shared/inventorySort'
import { useConfirmDelete } from '../shared/useConfirmDelete'
import PageContainer from '../shared/PageContainer'
import { FirstRunIntro } from '../shared/FirstRunIntro'
import { SecretsEntryDialog } from './SecretsEntryDialog'
import { SecretsDetailDialog } from './SecretsDetailDialog'
import { SecretsHistoryDialog } from './SecretsHistoryDialog'
import { SecretsAccessHistoryDialog } from './SecretsAccessHistoryDialog'
import styles from './SecretsView.module.css'

// The secret manager's human-facing surface (goal 0185 S2): browse,
// reveal/hide, copy with auto-clear, add/edit/delete, history --
// resolution into workflows/MCP servers is a separate, later consumer
// of the same vault (S3), not rendered here at all. Deliberately its
// own top-level page, not nested in Configure (the domain package's own
// doc comment has the full reasoning).
export default function SecretsView() {
  const { t } = useTranslation('secrets')
  // The vault-lock state door (goal 0222 S1, shared/vaultStatusStore.ts)
  // -- lifted out of local useState so secrets.lockVault/unlockVault's
  // own enabled() predicates can read the identical truth synchronously
  // from the palette/keyboard, not just from this view.
  const status = useVaultStatusStore((s) => s.vaultStatus)
  // The last lock/unlock outcome (goal 0330). Lives in the store, not
  // local state, because the buttons here run registry commands whose
  // run() returns void -- the failure has to reach this view some other
  // way than a returned promise.
  const vaultError = useVaultStatusStore((s) => s.vaultError)
  const [list, setList] = useState<SecretSummary[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [presenceBusy, setPresenceBusy] = useState(false)
  const [error, setError] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [editingID, setEditingID] = useState<string | null>(null)
  const [detailID, setDetailID] = useState<string | null>(null)
  const [historyID, setHistoryID] = useState<string | null>(null)
  const [accessHistoryID, setAccessHistoryID] = useState<string | null>(null)
  const [showAccessHistory, setShowAccessHistory] = useState(false)
  const [confirmReset, setConfirmReset] = useState(false)

  const refresh = () => {
    void refreshVaultStatus().then(() => {
      const s = useVaultStatusStore.getState().vaultStatus
      if (s?.Unlocked) {
        SecretService.ListSecrets().then(setList).catch((err) => setError(String(err)))
      } else {
        setList(null)
      }
    })
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

  // The first-run intro (goal 0202): rendered in every state of this
  // view -- a first visit usually lands on setup, but "first visit to
  // Secrets" is the moment, not any one vault state. The surface shows
  // itself at most once, ever (shared/FirstRunIntro.tsx).
  const firstRunIntro = (
    <FirstRunIntro id="secrets" title={t('firstRun.title')} body={[t('firstRun.body1'), t('firstRun.body2')]} />
  )

  if (!status.Exists) {
    return (
      <PageContainer variant="wide" data-testid="secrets-view">
        {firstRunIntro}
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

  const protectionStatus = status.RequireAuth ? t('touchId.requiredStatus') : t('touchId.keychainStatus')

  if (!status.Unlocked) {
    // One line, in this view's own words, for each way an unlock ends
    // badly. Anything the tokens don't name falls through to the error
    // itself rather than being hidden.
    const kind = vaultErrorKind(vaultError)
    const lockedMessage = {
      keyMismatch: t('locked.keyMismatch'),
      noKey: t('locked.noKey'),
      cancelled: t('locked.cancelled'),
      authUnavailable: t('locked.authUnavailable'),
      other: vaultError,
      none: '',
    }[kind]
    const resetCommand = findCommand('secrets.resetVault')

    return (
      <PageContainer variant="wide" data-testid="secrets-view">
        {firstRunIntro}
        <Blankslate>
          <Blankslate.Visual><LockIcon size={32} /></Blankslate.Visual>
          <Blankslate.Heading>{t('locked.heading')}</Blankslate.Heading>
          <Blankslate.Description>{t('locked.description')}</Blankslate.Description>
          <Text as="p" size="small" className={styles.subtitle} data-testid="secrets-protection-status">{protectionStatus}</Text>
          <Stack direction="horizontal" gap="condensed" align="center" justify="center">
            <Button
              variant="primary"
              onClick={() => void runCommand('secrets.unlockVault')}
              disabled={busy}
              data-testid="secrets-unlock-cta"
            >
              {t('locked.cta')}
            </Button>
            {resetCommand?.enabled?.() && (
              <Button onClick={() => setConfirmReset(true)} data-testid="secrets-reset-cta">
                {t('reset.cta')}
              </Button>
            )}
          </Stack>
          {lockedMessage && <Text as="p" size="small" className={styles.error} data-testid="secrets-unlock-error">{lockedMessage}</Text>}
        </Blankslate>
        {confirmReset && (
          <ConfirmDialog
            title={t('reset.confirmTitle')}
            body={t('reset.confirmBody')}
            confirmLabel={t('reset.confirmCta')}
            cancelLabel={t('reset.cancel')}
            onCancel={() => setConfirmReset(false)}
            onConfirm={() => {
              setConfirmReset(false)
              void runCommand('secrets.resetVault')
            }}
          />
        )}
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
    updatedAt: s.UpdatedAt,
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
      {firstRunIntro}
      <Stack direction="horizontal" justify="space-between" align="center" className={styles.header}>
        <Stack direction="vertical" gap="none">
          <Heading as="h1" id="secrets-heading">{t('heading')}</Heading>
          <Text as="p" size="small" className={styles.subtitle}>{t('subtitle')}</Text>
        </Stack>
        <Stack direction="horizontal" gap="condensed" align="center">
          <IconButton
            icon={HistoryIcon}
            aria-label={t('accessHistory.button')}
            variant="invisible"
            onClick={() => setShowAccessHistory(true)}
            data-testid="secrets-access-history-open"
          />
          <IconButton
            icon={LockIcon}
            aria-label={t('lockButton')}
            variant="invisible"
            // Clears any stale error (e.g. a Touch ID toggle failure)
            // before locking -- the locked Blankslate below renders this
            // same `error` state, and a message about a DIFFERENT prior
            // action must not survive into it.
            onClick={() => { setError(''); void runCommand('secrets.lockVault') }}
            data-testid="secrets-lock"
          />
          <Button leadingVisual={PlusIcon} variant="primary" onClick={startCreate} data-testid="secrets-new">
            {t('newSecret')}
          </Button>
        </Stack>
      </Stack>
      <Stack direction="horizontal" justify="space-between" align="center" className={styles.protectionRow}>
        <Text as="p" size="small" className={styles.subtitle} data-testid="secrets-protection-status">{protectionStatus}</Text>
        <FormControl disabled={!status.AuthAvailable}>
          <Checkbox
            checked={status.RequireAuth}
            disabled={presenceBusy || !status.AuthAvailable}
            onChange={(e) => toggleTouchID(e.target.checked)}
            data-testid="secrets-touchid-toggle"
          />
          <FormControl.Label>{t('touchId.toggleLabel')}</FormControl.Label>
          <FormControl.Caption>
            {status.AuthAvailable ? t('touchId.toggleCaption') : t('touchId.unavailableCaption')}
          </FormControl.Caption>
        </FormControl>
      </Stack>
      {error && <Text as="p" size="small" className={styles.error} data-testid="secrets-touchid-error">{error}</Text>}
      <InventoryList
        listId="secrets"
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
          onAccessHistory={() => setAccessHistoryID(detailID)}
          onDelete={() => requestDelete(sorted.find((s) => s.ID === detailID) ?? { ID: detailID, Title: detailID, Username: '', URL: '', Tags: '', UpdatedAt: '' })}
        />
      )}
      {historyID && <SecretsHistoryDialog id={historyID} onClose={() => setHistoryID(null)} />}
      {showAccessHistory && <SecretsAccessHistoryDialog onClose={() => setShowAccessHistory(false)} />}
      {accessHistoryID && (
        <SecretsAccessHistoryDialog
          entryId={accessHistoryID}
          entryLabel={sorted.find((s) => s.ID === accessHistoryID)?.Title ?? accessHistoryID}
          onClose={() => setAccessHistoryID(null)}
        />
      )}
      {confirmDialog}
    </PageContainer>
  )
}
