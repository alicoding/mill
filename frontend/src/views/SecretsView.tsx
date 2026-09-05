import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Events } from '@wailsio/runtime'
import { Blankslate } from '@primer/react/experimental'
import { Button, Heading, IconButton, Label, Link, SegmentedControl, Stack, Text } from '@primer/react'
import { DownloadIcon, HistoryIcon, KeyIcon, LockIcon, PlusIcon } from '@primer/octicons-react'
import { SecretService } from '../shared/bindings'
import { Kind } from '../../bindings/github.com/alicoding/mill/internal/domain/secret/models'
import type { SecretSummary } from '../shared/bindings'
import { findCommand, runCommand } from '../shared/commands'
import { refreshVaultBackupTime, refreshVaultStatus, useVaultStatusStore } from '../shared/vaultStatusStore'
import { vaultErrorKind } from '../shared/secretsCommands'
import { messageOf } from '../shared/userError'
import { humanizeLockAfter, unlockStatusKey } from '../shared/vaultLockCopy'
import type { TFunction } from 'i18next'
import { ConfirmDialog } from '../shared/ConfirmDialog'
import { InventoryList, type InventoryItem } from '../shared/InventoryList'
import { entityRowContext } from '../shared/entityRowCommands'
import { useUISignalStore } from '../shared/uiSignalStore'
import { ENTITY_ICON } from '../shared/entityIcons'
import { formatUpdated, sortByUpdatedDesc } from '../shared/inventorySort'
import { useConfirmDelete } from '../shared/useConfirmDelete'
import PageContainer from '../shared/PageContainer'
import { FirstRunIntro } from '../shared/FirstRunIntro'
import { ConfigureSecretSources } from '../configure/ConfigureSecretSources'
import { SecretsEntryDialog } from '../shared/SecretsEntryDialog'
import { SecretsDetailDialog } from './SecretsDetailDialog'
import { SecretsHistoryDialog } from './SecretsHistoryDialog'
import { SecretsAccessHistoryDialog } from './SecretsAccessHistoryDialog'
import { SecretsImportDialog } from './SecretsImportDialog'
import styles from './SecretsView.module.css'

type SecretsSection = 'vault' | 'sources'

// The page's two sections, and the deep-link tab values that land on
// each. An unrecognized tab lands on the entries, which is the section
// the page is named for. Lock policy moved to Settings > Security
// (goal 0360 S1 follow-up) -- it configures the kernel, not this
// vault's own content, the same reasoning Extensions' own move out of
// Settings already established in reverse.
function sectionFromTab(tab: string | undefined): SecretsSection {
  return tab === 'sources' ? tab : 'vault'
}

const SECTION_SUBTITLE_KEY: Record<SecretsSection, string> = {
  vault: 'subtitle',
  sources: 'sections.sourcesSubtitle',
}

// The status line is two sentences composed from state: what it takes
// to open the vault, then how long it stays open. Never a fixed
// string -- both halves are settings the reader can change one section
// away, and the first names only what this Mac can actually ask for.
function protectionSentences(t: TFunction<'secrets'>, requireAuth: boolean, capability: string, lockAfterSeconds: number): string {
  const unlock = requireAuth ? t(unlockStatusKey(capability)) : t('touchId.keychainStatus')
  const timeout = humanizeLockAfter(lockAfterSeconds)
  const idle = timeout === null
    ? t('locking.neverLocks')
    : t('locking.locksAfter', { duration: t(timeout.key, { count: timeout.count }) })
  return `${unlock} ${idle}`
}

// The secret manager's human-facing surface (goal 0185 S2): browse,
// reveal/hide, copy with auto-clear, add/edit/delete, history --
// resolution into workflows/MCP servers is a separate, later consumer
// of the same vault (S3), not rendered here at all. Deliberately its
// own top-level page, not nested in Configure (the domain package's own
// doc comment has the full reasoning).
export default function SecretsView({ initialTab }: { initialTab?: string } = {}) {
  const { t } = useTranslation('secrets')
  // Two sections, one page (goal 0306): the entries themselves, and the
  // stores Mill reads entries from. Sources are reachable while the
  // vault is locked -- they are configuration, not vault content.
  const [section, setSection] = useState<SecretsSection>(() => sectionFromTab(initialTab))
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
  const [error, setError] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [editingID, setEditingID] = useState<string | null>(null)
  const [detailID, setDetailID] = useState<string | null>(null)
  // The browse list's own search, held here so a tag chip in a row can
  // set it (goal 0306 S4).
  const [search, setSearch] = useState('')
  const [importOpen, setImportOpen] = useState(false)
  const [historyID, setHistoryID] = useState<string | null>(null)
  const [accessHistoryID, setAccessHistoryID] = useState<string | null>(null)
  const [showAccessHistory, setShowAccessHistory] = useState(false)
  const [confirmReset, setConfirmReset] = useState(false)
  // The key-mismatch state's own "Last backup" fact (goal 0359) lives
  // in the shared vault store, not local state: secrets.restoreVaultFromBackup's
  // own enabled() predicate needs to read it synchronously too.
  const vaultBackupTime = useVaultStatusStore((s) => s.vaultBackupTime)
  // What this Mac would actually ask for when the unlock requirement is
  // on, and how long it stays open -- the two halves of the status line
  // below. Read from the service rather than assumed, so the sentence
  // never promises hardware this Mac does not have.
  const [capability, setCapability] = useState('none')
  const [lockAfterSeconds, setLockAfterSeconds] = useState(0)

  const sectionSwitch = (
    <SegmentedControl aria-label={t('sections.ariaLabel')} className={styles.sections} data-testid="secrets-sections">
      <SegmentedControl.Button selected={section === 'vault'} onClick={() => setSection('vault')} data-testid="secrets-section-vault">
        {t('sections.vault')}
      </SegmentedControl.Button>
      <SegmentedControl.Button selected={section === 'sources'} onClick={() => setSection('sources')} data-testid="secrets-section-sources">
        {t('sections.sources')}
      </SegmentedControl.Button>
    </SegmentedControl>
  )

  // The status line's trailing link (goal 0360 S1 follow-up): the lock
  // policy it half-describes now lives at Settings > Security, one
  // command away from wherever this line renders.
  const changeInSettingsLink = (
    <Link
      href="#"
      onClick={(e) => { e.preventDefault(); void runCommand('settings.open.security') }}
      data-testid="secrets-protection-settings-link"
    >
      {t('protectionSettingsLink')}
    </Link>
  )

  // pageHeader is rendered by every branch below -- locked, unset and
  // unlocked, vault and sources -- so this page is titled the same way
  // in each of them, and Sources stays one click away. The subtitle is
  // the one part that differs: it says what THIS section is.
  const pageHeader = (
    <>
      <Stack direction="vertical" gap="none" className={styles.pageHeader}>
        <Heading as="h1" id="secrets-heading">{t('heading')}</Heading>
        <Text as="p" size="small" className={styles.subtitle}>
          {t(SECTION_SUBTITLE_KEY[section])}
        </Text>
      </Stack>
      {sectionSwitch}
    </>
  )

  const refresh = () => {
    SecretService.VaultLockPolicy().then((p) => setLockAfterSeconds(p.LockAfterSeconds)).catch(() => undefined)
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
    SecretService.UnlockCapability().then(setCapability).catch(() => setCapability('none'))
  }, [])

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

  const startCreate = () => {
    setEditingID(null)
    setFormOpen(true)
  }

  const startEdit = (id: string) => {
    setDetailID(null)
    setEditingID(id)
    setFormOpen(true)
  }

  // secret.row.edit / secret.row.history (goal 0346): the row's actions
  // are registry commands, which cannot reach this view's own panels --
  // they name the row through a signal, consumed the same set-then-
  // consume way Configure's edit jump already is.
  const secretPanelRequest = useUISignalStore((s) => s.secretPanelRequest)
  const consumeSecretPanel = useUISignalStore((s) => s.consumeSecretPanel)
  useEffect(() => {
    if (!secretPanelRequest) return
    const { panel, id } = secretPanelRequest
    consumeSecretPanel()
    if (panel === 'edit') startEdit(id)
    else setHistoryID(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- startEdit/consumeSecretPanel deliberately excluded, the same set-then-consume shape ConfigureLists.tsx's own signal effect documents
  }, [secretPanelRequest])

  // A deleted secret's detail panel has nothing left to show; the row
  // command that deleted it cannot reach this state, so the list it
  // re-read is what closes the panel.
  useEffect(() => {
    if (detailID && list !== null && !list.some((s) => s.ID === detailID)) setDetailID(null)
  }, [list, detailID])

  // The key-mismatch caption + secrets.restoreVaultFromBackup's own
  // enablement (goal 0359): only fetched while that exact state is
  // showing, cleared otherwise.
  useEffect(() => {
    if (!status || status.Unlocked || vaultErrorKind(vaultError) !== 'keyMismatch') {
      useVaultStatusStore.getState().setVaultBackupTime(null)
      return
    }
    void refreshVaultBackupTime()
  }, [status, vaultError])

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

  if (section === 'sources') {
    return (
      <PageContainer variant="wide" data-testid="secrets-view">
        {firstRunIntro}
        {pageHeader}
        <ConfigureSecretSources />
      </PageContainer>
    )
  }

  if (!status.Exists) {
    return (
      <PageContainer variant="wide" data-testid="secrets-view">
        {firstRunIntro}
        {pageHeader}
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

  const protectionStatus = protectionSentences(t, status.RequireAuth, capability, lockAfterSeconds)

  if (!status.Unlocked) {
    // One line, in this view's own words, for each way an unlock ends
    // badly. Anything the tokens don't name falls through to the error
    // itself rather than being hidden.
    const kind = vaultErrorKind(vaultError)
    const isKeyMismatch = kind === 'keyMismatch'
    // The key-mismatch state names the cause in its own heading/body
    // (goal 0359) rather than the generic locked copy plus a red error
    // line -- every other unlock failure keeps today's shape.
    const lockedMessage = {
      keyMismatch: '',
      noKey: t('common:errors.no-vault-key'),
      cancelled: t('common:errors.unlock-cancelled'),
      authUnavailable: t('common:errors.auth-unavailable'),
      other: messageOf(vaultError ?? { code: 'unexpected', message: '' }, t),
      none: '',
    }[kind]
    const resetCommand = findCommand('secrets.resetVault')
    const restoreCommand = findCommand('secrets.restoreVaultFromBackup')

    return (
      <PageContainer variant="wide" data-testid="secrets-view">
        {firstRunIntro}
        {pageHeader}
        <Blankslate>
          <Blankslate.Visual><LockIcon size={32} /></Blankslate.Visual>
          <Blankslate.Heading>{isKeyMismatch ? t('locked.keyMismatchHeading') : t('locked.heading')}</Blankslate.Heading>
          <Blankslate.Description>{isKeyMismatch ? t('locked.keyMismatchBody') : t('locked.description')}</Blankslate.Description>
          <Stack direction="horizontal" gap="condensed" align="center" justify="center">
            <Text as="p" size="small" className={styles.subtitle} data-testid="secrets-protection-status">{protectionStatus}</Text>
            {changeInSettingsLink}
          </Stack>
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
            {restoreCommand?.enabled?.() && (
              <Button onClick={() => void runCommand('secrets.restoreVaultFromBackup')} data-testid="secrets-restore-backup-cta">
                {t('locked.restoreBackupCta')}
              </Button>
            )}
          </Stack>
          {lockedMessage && <Text as="p" size="small" className={styles.error} data-testid="secrets-unlock-error">{lockedMessage}</Text>}
          {isKeyMismatch && vaultBackupTime?.present && (
            <Text as="p" size="small" className={styles.subtitle} data-testid="secrets-vault-backup-caption">
              {t('locked.lastBackup', { time: new Date(vaultBackupTime.time).toLocaleString() })}
            </Text>
          )}
          {restoreCommand?.enabled?.() && (
            <Text as="p" size="small" className={styles.subtitle} data-testid="secrets-restore-backup-caption">
              {t('locked.restoreBackupCaption')}
            </Text>
          )}
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
    // A tag is clickable: it narrows the list to everything carrying
    // it, which is the whole reason to put one on an entry.
    labelBadges: (s.Tags ?? []).length === 0 ? undefined : (
      <>
        {(s.Tags ?? []).map((tag) => (
          <Label
            key={tag}
            as="button"
            onClick={(e: React.MouseEvent) => { e.stopPropagation(); setSearch(`tag:${tag}`) }}
            data-testid={`secret-tag-${tag}`}
          >
            {tag}
          </Label>
        ))}
      </>
    ),
    // The list's search finds an entry by a tag or by the NAME of a
    // field it carries -- never by a value, which is not here at all.
    searchTerms: [...(s.Tags ?? []), ...(s.Tags ?? []).map((tag) => `tag:${tag}`), ...(s.FieldNames ?? [])],
    description: s.Username || s.URL || undefined,
    updatedLabel: formatUpdated(s.UpdatedAt),
    updatedAt: s.UpdatedAt,
    onOpen: () => setDetailID(s.ID),
    menuActions: [
      { commandId: 'secret.row.edit', ctx: entityRowContext('secret', s.ID) },
      { commandId: 'secret.row.history', ctx: entityRowContext('secret', s.ID) },
      {
        commandId: 'secret.row.delete',
        ctx: entityRowContext('secret', s.ID),
        danger: true,
        confirm: { title: t('deleteConfirmTitle'), body: t('deleteConfirmBody', { label: s.Title }) },
      },
    ],
  }))

  return (
    <PageContainer variant="wide" data-testid="secrets-view">
      {firstRunIntro}
      {pageHeader}
      <Stack direction="horizontal" justify="end" align="center" className={styles.header}>
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
          <Button leadingVisual={DownloadIcon} onClick={() => setImportOpen(true)} data-testid="secrets-import">
            {t('import.button')}
          </Button>
          <Button leadingVisual={PlusIcon} variant="primary" onClick={startCreate} data-testid="secrets-new">
            {t('newSecret')}
          </Button>
        </Stack>
      </Stack>
      <Stack direction="horizontal" justify="space-between" align="center" className={styles.protectionRow}>
        <Text as="p" size="small" className={styles.subtitle} data-testid="secrets-protection-status">{protectionStatus}</Text>
        {changeInSettingsLink}
      </Stack>
      {error && <Text as="p" size="small" className={styles.error} data-testid="secrets-error">{error}</Text>}
      <InventoryList
        listId="secrets"
        items={items}
        searchPlaceholder={t('searchPlaceholder')}
        searchQuery={search}
        onSearchQueryChange={setSearch}
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
          onDelete={() => requestDelete(sorted.find((s) => s.ID === detailID) ?? { ID: detailID, Title: detailID, Username: '', URL: '', Tags: [], FieldNames: [], Kind: Kind.KindText, SourceRef: '', UpdatedAt: '' })}
        />
      )}
      {importOpen && <SecretsImportDialog onClose={() => setImportOpen(false)} onImported={() => { setImportOpen(false); refresh() }} />}
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
