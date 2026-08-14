import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ActionList, ActionMenu, Button, Heading, IconButton, Label, Stack, Text, VisuallyHidden } from '@primer/react'
import { DownloadIcon, PencilIcon, PlugIcon, TrashIcon, UploadIcon } from '@primer/octicons-react'
import { DataTable } from '@primer/react/experimental'
import { StatusStamp } from '../shared/StatusStamp'
import { ResizableTableContainer, TruncatedCell } from '../shared/ResizableTable'
import { ViewModeToggle } from '../shared/ViewModeToggle'
import { useViewMode } from '../shared/viewMode'
import { ConfigureService } from '../shared/bindings'
import type { HTTPRequest } from '../../bindings/github.com/alicoding/mill/internal/domain/httprequest/models'
import { authLabelFor } from './authTypeLabels'
import { refreshRequests, useAppStore } from '../shared/store'
import { downloadJSON } from '../shared/downloadJSON'
import { InventoryList, type InventoryItem } from '../shared/InventoryList'
import { ENTITY_ICON } from '../shared/entityIcons'
import { formatUpdated, sortByUpdatedDesc } from '../shared/inventorySort'
import { useConfirmDelete } from '../shared/useConfirmDelete'
import { useImportConfirm } from '../shared/useImportConfirm'
import { describeSeedReset } from '../shared/seedLifecycle'
import { RestoreExamplesButton } from '../shared/RestoreExamplesButton'
import styles from '../shared/ListCard.module.css'
import PageContainer from '../shared/PageContainer'

// Configure's Integration section (docs/SPEC.md §3.5): the Integrations
// inventory. Viewing/editing no longer opens tabs here -- open work
// items live in the app-wide work-tab strip (docs/SPEC.md §3.8,
// app/WorkTabShell.tsx), so an open integration survives navigating to
// any other section; this page is purely the list plus its create/
// import/export actions. The request list itself is store-shared
// (refreshRequests), the same one the shell's tabs read.
//
// Rows are the DEFAULT view (docs/goals/0007): InventoryList's shared
// row replaces the old hand-rolled card branch -- distinct leading
// icon/color from Workflows' own row, the exact ambiguity the goal's
// live-reproduced bug named ("thought they were on the workflow page
// while on integrations"). Row click opens the read-only summary (the
// existing label-link behavior); Edit/Export/Delete move into the
// trailing ⋯ menu.
export function ConfigureRequests() {
  const { t } = useTranslation('configure')
  const AUTH_LABEL_MAP = authLabelFor(t)
  const requests = useAppStore((s) => s.requests)
  const openWorkTab = useAppStore((s) => s.openWorkTab)
  const [importError, setImportError] = useState<string | null>(null)
  const importInputRef = useRef<HTMLInputElement>(null)
  const [viewMode, setViewMode] = useViewMode('mill-requests-view-mode')
  // Seed lifecycle (docs/goals/0037) -- see CompositionView.tsx's
  // identical state for the full reasoning.
  const [seedRevisions, setSeedRevisions] = useState<Record<string, number | undefined>>({})
  const [restorable, setRestorable] = useState<HTTPRequest[]>([])

  const refreshSeedLifecycle = () => {
    ConfigureService.SeedRevisions().then((m) => setSeedRevisions(m ?? {})).catch(console.error)
    ConfigureService.RestorableHTTPRequests().then((r) => setRestorable(r ?? [])).catch(console.error)
  }

  useEffect(() => {
    void refreshRequests()
    refreshSeedLifecycle()
  }, [])

  // Never carries a secret -- ExportHTTPRequest's own contract
  // (configureservice_export.go).
  const exportRequest = (id: string, label: string) => {
    ConfigureService.ExportHTTPRequest(id)
      .then((json) => downloadJSON(`${label.trim() || 'request'}.json`, json))
      .catch((err) => setImportError(String(err)))
  }

  const openImportPicker = () => {
    setImportError(null)
    importInputRef.current?.click()
  }

  // A payload whose id matches a request already here updates it in
  // place instead of creating a new one -- confirmed first via
  // importConfirm below, naming the request it will replace.
  const runImport = (text: string) => {
    ConfigureService.ImportHTTPRequest(text)
      .then(() => { setImportError(null); void refreshRequests() })
      .catch((err) => setImportError(String(err)))
  }
  const importConfirm = useImportConfirm({ existing: requests ?? [], onImport: runImport })
  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    file.text().then(importConfirm.requestImport).catch((err) => setImportError(String(err)))
  }

  const remove = (id: string) => {
    ConfigureService.DeleteHTTPRequest(id).then(() => {
      void refreshRequests()
      refreshSeedLifecycle()
    }).catch(console.error)
  }

  // Reset-to-shipped-example / restore-deleted-example (docs/goals/0037
  // items 4/5).
  const resetToSeed = (id: string) => {
    ConfigureService.ResetHTTPRequestToSeed(id).then(() => {
      void refreshRequests()
      refreshSeedLifecycle()
    }).catch((err) => setImportError(String(err)))
  }
  const restoreExample = (id: string) => {
    ConfigureService.RestoreHTTPRequest(id).then(() => {
      void refreshRequests()
      refreshSeedLifecycle()
    }).catch((err) => setImportError(String(err)))
  }

  // Table-view direct-wiring half of the Button-semantics convention
  // (.claude/rules/frontend.md) -- the row menu path below gets
  // confirmation for free via InventoryList's own opt-in `confirm`
  // field; the DataTable view's bare TrashIcon wires ConfirmDialog
  // directly via the shared hook.
  const { requestDelete, dialog: confirmDialog } = useConfirmDelete<HTTPRequest>({
    entityType: 'integration',
    labelOf: (r) => r.Label,
    onConfirm: (r) => remove(r.ID),
  })

  // One "New integration" entry point with a typed menu -- the
  // integration *kind* is the first authoring decision (docs/SPEC.md
  // §4.1's connector-kind row: REST today; DB/other kinds are future
  // menu items here, not future pages). Shared between the header and
  // the empty-state Blankslate below so there's exactly one create
  // action, not two independent copies of it.
  const newIntegrationMenu = (
    <ActionMenu>
      <ActionMenu.Button size="small" variant="primary" data-testid="new-integration">
        {t('configureRequests.newIntegration')}
      </ActionMenu.Button>
      <ActionMenu.Overlay width="medium">
        <ActionList>
          <ActionList.Item onSelect={() => openWorkTab({ kind: 'request-new' })} data-testid="new-integration-rest">
            {t('configureRequests.restApiRequest')}
            <ActionList.Description variant="block">
              {t('configureRequests.restApiRequestDescription')}
            </ActionList.Description>
          </ActionList.Item>
        </ActionList>
      </ActionMenu.Overlay>
    </ActionMenu>
  )

  // Last-updated-first, applied once so both view modes render the
  // same order (docs/SPEC.md §3.8's InventoryList entry).
  const sortedRequests = useMemo(() => sortByUpdatedDesc(requests ?? [], (r) => r.UpdatedAt), [requests])

  const requestItems: InventoryItem[] = sortedRequests.map((r) => {
    const seedReset = describeSeedReset(r.Seed, seedRevisions[r.ID] ?? r.Seed.SeedRevision)
    return {
      id: r.ID,
      entity: 'request',
      icon: ENTITY_ICON.request,
      label: r.Label,
      updatedLabel: formatUpdated(r.UpdatedAt),
      labelBadges: (
        <Stack direction="horizontal" gap="condensed" align="center">
          <Label variant="secondary" size="small">{AUTH_LABEL_MAP[r.AuthType] ?? r.AuthType}</Label>
          {/* No !r.BuiltIn guard on Delete -- a seeded example is ordinary
              and fully editable/deletable (docs/SPEC.md §2.2's Update
              note). */}
          {r.BuiltIn && <StatusStamp variant="identity">{t('builtIn')}</StatusStamp>}
        </Stack>
      ),
      description: [r.BaseURL, r.Description].filter((s) => s && s.trim() !== '').join(' · '),
      onOpen: () => openWorkTab({ kind: 'request-view', requestId: r.ID }),
      menuActions: [
        { label: t('edit'), onClick: () => openWorkTab({ kind: 'request-edit', requestId: r.ID }) },
        { label: t('export'), onClick: () => exportRequest(r.ID, r.Label) },
        // Reset-to-shipped-example (docs/goals/0037 item 4) -- hidden
        // (not shown-disabled) when already current, same reasoning
        // CompositionView.tsx's identical wiring documents.
        ...(r.BuiltIn && !seedReset.disabled ? [{ label: seedReset.label, onClick: () => resetToSeed(r.ID) }] : []),
        {
          label: t('delete'),
          onClick: () => remove(r.ID),
          danger: true,
          confirm: { title: t('requestSummary.deleteConfirmTitle'), body: t('requestSummary.deleteConfirmBody', { label: r.Label }) },
        },
      ],
    }
  })

  return (
    <PageContainer data-testid="configure-requests">
      <Stack direction="horizontal" justify="end" align="center" className={styles.sectionHeading}>
        {/* Design-wave-1 fix #6: the Configure tab already names this
            section -- visually hidden (not removed) so the aria-labelledby
            wiring below and the a11y heading structure both stay intact. */}
        <VisuallyHidden>
          <Heading as="h2" variant="small" id="integrations-heading">{t('configureRequests.heading')}</Heading>
        </VisuallyHidden>
        <Stack direction="horizontal" gap="condensed">
          <ViewModeToggle mode={viewMode} onChange={setViewMode} />
          <input
            ref={importInputRef}
            type="file"
            accept="application/json,.json"
            data-testid="import-request-input"
            style={{ display: 'none' }}
            onChange={handleImportFile}
          />
          <Button leadingVisual={UploadIcon} size="small" onClick={openImportPicker} data-testid="import-request">
            {t('import')}
          </Button>
          <RestoreExamplesButton items={restorable} onRestore={restoreExample} />
          {newIntegrationMenu}
        </Stack>
      </Stack>
      {importError && (
        <Text as="p" size="small" className={styles.error} data-testid="import-request-error">{importError}</Text>
      )}

      {requests === null && <Text as="p" className={styles.muted}>{t('loading')}</Text>}
      {requests !== null && viewMode === 'table' && requests.length > 0 && (
        <ResizableTableContainer storageKey="mill-cols-requests">
          <DataTable
            aria-labelledby="integrations-heading"
            data={sortedRequests.map((r) => ({ ...r, id: r.ID }))}
            columns={[
              {
                header: t('configureRequests.columns.label'), field: 'Label', rowHeader: true, sortBy: 'alphanumeric',
                renderCell: (r) => (
                  <span role="button" tabIndex={0} style={{ cursor: 'pointer', fontWeight: 600 }}
                    onClick={() => openWorkTab({ kind: 'request-view', requestId: r.ID })}
                    onKeyDown={(e) => { if (e.key === 'Enter') openWorkTab({ kind: 'request-view', requestId: r.ID }) }}>
                    {r.Label}
                  </span>
                ),
              },
              { header: t('configureRequests.columns.method'), id: 'method', width: 'auto', renderCell: (r) => r.Method || 'GET' },
              { header: t('configureRequests.columns.auth'), id: 'auth', width: 'auto', renderCell: (r) => AUTH_LABEL_MAP[r.AuthType] ?? r.AuthType },
              { header: t('configureRequests.columns.url'), id: 'url', width: 'growCollapse', minWidth: '160px', renderCell: (r) => <TruncatedCell text={r.BaseURL} mono /> },
              {
                header: '', id: 'actions', width: 'auto', align: 'end',
                renderCell: (r) => (
                  <Stack direction="horizontal" gap="condensed">
                    <IconButton icon={PencilIcon} aria-label={t('configureRequests.editAriaLabel', { label: r.Label })} size="small" variant="invisible" onClick={() => openWorkTab({ kind: 'request-edit', requestId: r.ID })} />
                    <IconButton icon={DownloadIcon} aria-label={t('configureRequests.exportAriaLabel', { label: r.Label })} size="small" variant="invisible" onClick={() => exportRequest(r.ID, r.Label)} />
                    <IconButton icon={TrashIcon} aria-label={t('configureRequests.deleteAriaLabel', { label: r.Label })} size="small" variant="invisible" onClick={() => requestDelete(r)} />
                  </Stack>
                ),
              },
            ]}
          />
        </ResizableTableContainer>
      )}
      {requests !== null && viewMode === 'rows' && (
        <InventoryList
          items={requestItems}
          searchPlaceholder={t('configureRequests.searchPlaceholder')}
          emptyState={{
            icon: PlugIcon,
            heading: t('configureRequests.emptyHeading'),
            description: t('configureRequests.emptyDescription'),
            action: newIntegrationMenu,
          }}
        />
      )}
      {confirmDialog}
      {importConfirm.dialog}
    </PageContainer>
  )
}
