import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Events } from '@wailsio/runtime'
import { Blankslate } from '@primer/react/experimental'
import { Button, Heading, IconButton, Link, SegmentedControl, Stack, Text } from '@primer/react'
import { DownloadIcon, HistoryIcon, KeyIcon, LockIcon, PlusIcon } from '@primer/octicons-react'
import { SecretService } from '../shared/bindings'
import { Kind } from '../../bindings/github.com/alicoding/mill/internal/domain/secret/models'
import type { SecretSummary } from '../shared/bindings'
import { runCommand } from '../shared/commands'
import { refreshVaultBackupTime, refreshVaultStatus, useVaultStatusStore } from '../shared/vaultStatusStore'
import { vaultErrorKind } from '../shared/secretsCommands'
import { humanizeLockAfter, unlockStatusKey } from '../shared/vaultLockCopy'
import type { TFunction } from 'i18next'
import { InventoryList } from '../shared/InventoryList'
import { SecretsLockedPanel } from './SecretsLockedPanel'
import { useUISignalStore } from '../shared/uiSignalStore'
import { useConfirmDelete } from '../shared/useConfirmDelete'
import { useUndoJournal } from '../shared/useUndoJournal'
import PageContainer from '../shared/PageContainer'
import { FirstRunIntro } from '../shared/FirstRunIntro'
import { ConfigureSecretSources } from '../configure/ConfigureSecretSources'
import { refreshSecretSources, useConfigureEntityStore } from '../shared/configureEntityStore'
import { buildSecretRowItems } from './secretRowItems'
import { SecretsEntryDialog } from '../shared/SecretsEntryDialog'
import { SecretsDetailDialog } from './SecretsDetailDialog'
import { SecretsProviderDetailDialog } from './SecretsProviderDetailDialog'
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
  // kindLabel (configure/secretSourceFields.ts) is the ONE existing
  // resolver for a source's kind wording -- passed into
  // buildSecretRowItems (secretRowItems.tsx) for the row's own kind
  // badge rather than a second copy of the same switch.
  const { t: tConfigure } = useTranslation('configure')
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
  // Every enabled source's own keys (goal 0408 S2): fetched alongside
  // the vault's own list, behind the SAME unlock gate -- a row is a
  // secret entry, vault or source-backed, and the gate stays the one
  // the design contract names ("same actions, same gate").
  const [providerList, setProviderList] = useState<SecretSummary[] | null>(null)
  const secretSources = useConfigureEntityStore((s) => s.secretSources)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [editingID, setEditingID] = useState<string | null>(null)
  const [detailID, setDetailID] = useState<string | null>(null)
  const [providerDetailID, setProviderDetailID] = useState<string | null>(null)
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

  // The Sources section's rows delete through the same registry command
  // Configure's own panes use, and that delete's toast Undo pops the
  // app's ONE undo journal (ADR-0044, goal 0352 part 2) -- the journal
  // consumer must be mounted on every surface that can delete, or the
  // toast's Undo bumps a signal nobody reads here. One mount per
  // surface; views never overlap.
  const [undoNotice, setUndoNotice] = useState('')
  useUndoJournal({ onSkip: setUndoNotice, onApplied: () => setUndoNotice('') })

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
      {undoNotice && (
        <Text as="p" size="small" className={styles.subtitle} data-testid="secrets-undo-notice">{undoNotice}</Text>
      )}
    </>
  )

  const refresh = () => {
    SecretService.VaultLockPolicy().then((p) => setLockAfterSeconds(p.LockAfterSeconds)).catch(() => undefined)
    void refreshVaultStatus().then(() => {
      const s = useVaultStatusStore.getState().vaultStatus
      if (s?.Unlocked) {
        SecretService.ListSecrets().then(setList).catch((err) => setError(String(err)))
        SecretService.ListProviderSecrets().then(setProviderList).catch(() => setProviderList([]))
      } else {
        setList(null)
        setProviderList(null)
      }
    })
  }

  useEffect(() => {
    SecretService.UnlockCapability().then(setCapability).catch(() => setCapability('none'))
    void refreshSecretSources()
  }, [])

  useEffect(() => {
    refresh()
    return Events.On('mill-data-changed', (evt) => {
      const entity = (evt.data as { entity?: string })?.entity
      if (entity === 'secret') refresh()
    })
  }, [])

  // A source's file changing on disk (goal 0408 S1's watcher) reaches
  // this list live -- a key added or removed is a row appearing or
  // vanishing, not just the Sources row's own count.
  useEffect(() => {
    return Events.On('secrets:sources-changed', () => {
      void refreshSecretSources()
      const s = useVaultStatusStore.getState().vaultStatus
      if (s?.Unlocked) SecretService.ListProviderSecrets().then(setProviderList).catch(() => setProviderList([]))
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

  // Sources ▸ "Show n keys in the list" (goal 0408 S2): narrows this
  // section's own search to the source's label, the same tag-chip
  // convention this view's own labelBadges already use.
  const secretsListFilterRequest = useUISignalStore((s) => s.secretsListFilterRequest)
  const consumeSecretsListFilter = useUISignalStore((s) => s.consumeSecretsListFilter)
  useEffect(() => {
    if (secretsListFilterRequest === null) return
    setSearch(secretsListFilterRequest)
    consumeSecretsListFilter()
  }, [secretsListFilterRequest, consumeSecretsListFilter])

  // A deleted secret's detail panel has nothing left to show; the row
  // command that deleted it cannot reach this state, so the list it
  // re-read is what closes the panel.
  useEffect(() => {
    if (detailID && list !== null && !list.some((s) => s.ID === detailID)) setDetailID(null)
  }, [list, detailID])

  // The same closing rule for a source-backed row (goal 0408 S2): its
  // key can vanish from the file between one refresh and the next.
  useEffect(() => {
    if (providerDetailID && providerList !== null && !providerList.some((s) => s.ID === providerDetailID)) setProviderDetailID(null)
  }, [providerList, providerDetailID])

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
    return (
      <PageContainer variant="wide" data-testid="secrets-view">
        {firstRunIntro}
        {pageHeader}
        <SecretsLockedPanel
          t={t}
          vaultError={vaultError}
          protectionStatus={protectionStatus}
          busy={busy}
          changeInSettingsLink={changeInSettingsLink}
          confirmReset={confirmReset}
          setConfirmReset={setConfirmReset}
          vaultBackupTime={vaultBackupTime}
        />
      </PageContainer>
    )
  }

  const { sorted, providerRows, items } = buildSecretRowItems({
    list, providerList, secretSources, t, tConfigure, setSearch, setDetailID, setProviderDetailID,
  })

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
        // No Undo (goal 0404 S1 amendment): a secret's delete registers
        // nothing in the journal -- an undo journal holding a deleted
        // secret's VALUE is the wrong primitive (goal 0406 is the
        // recently-deleted trash instead). The bulk toast still reports
        // the outcome, just with no Undo button
        // (shared/entityDeleteDoors.ts reads `secrets`' own
        // `undoable: false`).
        selection={{ entity: 'secret' }}
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
          onDelete={() => requestDelete(sorted.find((s) => s.ID === detailID) ?? { ID: detailID, Title: detailID, Username: '', URL: '', Tags: [], FieldNames: [], Kind: Kind.KindText, SourceRef: '', Origin: '', UpdatedAt: '' })}
        />
      )}
      {providerDetailID && (() => {
        const row = providerRows.find((r) => r.id === providerDetailID)
        return row ? (
          <SecretsProviderDetailDialog
            id={row.id}
            keyName={row.key}
            sourceLabel={row.sourceLabel}
            onClose={() => setProviderDetailID(null)}
            onAccessHistory={() => setAccessHistoryID(row.id)}
          />
        ) : null
      })()}
      {importOpen && <SecretsImportDialog onClose={() => setImportOpen(false)} onImported={() => { setImportOpen(false); refresh() }} />}
      {historyID && <SecretsHistoryDialog id={historyID} onClose={() => setHistoryID(null)} />}
      {showAccessHistory && <SecretsAccessHistoryDialog onClose={() => setShowAccessHistory(false)} />}
      {accessHistoryID && (
        <SecretsAccessHistoryDialog
          entryId={accessHistoryID}
          entryLabel={sorted.find((s) => s.ID === accessHistoryID)?.Title ?? providerRows.find((r) => r.id === accessHistoryID)?.key ?? accessHistoryID}
          onClose={() => setAccessHistoryID(null)}
        />
      )}
      {confirmDialog}
    </PageContainer>
  )
}
