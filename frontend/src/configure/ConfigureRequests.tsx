import { useEffect, useMemo, useRef, useState } from 'react'
import { ActionList, ActionMenu, Button, Heading, IconButton, Label, Stack, Text } from '@primer/react'
import { DownloadIcon, PencilIcon, PlugIcon, TrashIcon, UploadIcon } from '@primer/octicons-react'
import { DataTable } from '@primer/react/experimental'
import { ResizableTableContainer, TruncatedCell } from '../shared/ResizableTable'
import { ViewModeToggle } from '../shared/ViewModeToggle'
import { useViewMode } from '../shared/viewMode'
import { ConfigureService } from '../shared/bindings'
import { AUTH_LABEL } from './authTypeLabels'
import { refreshRequests, useAppStore } from '../shared/store'
import { downloadJSON } from '../shared/downloadJSON'
import { InventoryList, type InventoryItem } from '../shared/InventoryList'
import { ENTITY_ICON } from '../shared/entityIcons'
import { formatUpdated, sortByUpdatedDesc } from '../shared/inventorySort'
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
// owner-reported bug named ("thought they were on the workflow page
// while on integrations"). Row click opens the read-only summary (the
// existing label-link behavior); Edit/Export/Delete move into the
// trailing ⋯ menu.
export function ConfigureRequests() {
  const requests = useAppStore((s) => s.requests)
  const openWorkTab = useAppStore((s) => s.openWorkTab)
  const [importError, setImportError] = useState<string | null>(null)
  const importInputRef = useRef<HTMLInputElement>(null)
  const [viewMode, setViewMode] = useViewMode('mill-requests-view-mode')

  useEffect(() => {
    void refreshRequests()
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

  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    file.text()
      .then((text) => ConfigureService.ImportHTTPRequest(text))
      .then(() => { setImportError(null); void refreshRequests() })
      .catch((err) => setImportError(String(err)))
  }

  const remove = (id: string) => {
    ConfigureService.DeleteHTTPRequest(id).then(() => refreshRequests()).catch(console.error)
  }

  // One "New integration" entry point with a typed menu -- the
  // integration *kind* is the first authoring decision (docs/SPEC.md
  // §4.1's connector-kind row: REST today; DB/other kinds are future
  // menu items here, not future pages). Shared between the header and
  // the empty-state Blankslate below so there's exactly one create
  // action, not two independent copies of it.
  const newIntegrationMenu = (
    <ActionMenu>
      <ActionMenu.Button size="small" variant="primary" data-testid="new-integration">
        New integration
      </ActionMenu.Button>
      <ActionMenu.Overlay width="medium">
        <ActionList>
          <ActionList.Item onSelect={() => openWorkTab({ kind: 'request-new' })} data-testid="new-integration-rest">
            REST API request
            <ActionList.Description variant="block">
              Call an external HTTP API — typed request/response schema, auth, headers.
            </ActionList.Description>
          </ActionList.Item>
        </ActionList>
      </ActionMenu.Overlay>
    </ActionMenu>
  )

  // Last-updated-first, applied once so both view modes render the
  // same order (docs/SPEC.md §3.8's InventoryList entry).
  const sortedRequests = useMemo(() => sortByUpdatedDesc(requests ?? [], (r) => r.UpdatedAt), [requests])

  const requestItems: InventoryItem[] = sortedRequests.map((r) => ({
    id: r.ID,
    entity: 'request',
    icon: ENTITY_ICON.request,
    label: r.Label,
    updatedLabel: formatUpdated(r.UpdatedAt),
    labelBadges: (
      <Stack direction="horizontal" gap="condensed" align="center">
        <Label variant="secondary" size="small">{AUTH_LABEL[r.AuthType] ?? r.AuthType}</Label>
        {/* No !r.BuiltIn guard on Delete -- a seeded example is ordinary
            and fully editable/deletable (docs/SPEC.md §2.2's Update
            note). */}
        {r.BuiltIn && <Label variant="secondary" size="small">built-in</Label>}
      </Stack>
    ),
    description: [r.BaseURL, r.Description].filter((s) => s && s.trim() !== '').join(' · '),
    onOpen: () => openWorkTab({ kind: 'request-view', requestId: r.ID }),
    menuActions: [
      { label: 'Edit', onClick: () => openWorkTab({ kind: 'request-edit', requestId: r.ID }) },
      { label: 'Export', onClick: () => exportRequest(r.ID, r.Label) },
      { label: 'Delete', onClick: () => remove(r.ID), danger: true },
    ],
  }))

  return (
    <PageContainer data-testid="configure-requests">
      <Stack direction="horizontal" justify="space-between" align="center" className={styles.sectionHeading}>
        <Heading as="h2" variant="small" id="integrations-heading">Integrations</Heading>
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
            Import
          </Button>
          {newIntegrationMenu}
        </Stack>
      </Stack>
      {importError && (
        <Text as="p" size="small" className={styles.error} data-testid="import-request-error">{importError}</Text>
      )}

      {requests === null && <Text as="p" className={styles.muted}>Loading…</Text>}
      {requests !== null && viewMode === 'table' && requests.length > 0 && (
        <ResizableTableContainer storageKey="mill-cols-requests">
          <DataTable
            aria-labelledby="integrations-heading"
            data={sortedRequests.map((r) => ({ ...r, id: r.ID }))}
            columns={[
              {
                header: 'Label', field: 'Label', rowHeader: true, sortBy: 'alphanumeric',
                renderCell: (r) => (
                  <span role="button" tabIndex={0} style={{ cursor: 'pointer', fontWeight: 600 }}
                    onClick={() => openWorkTab({ kind: 'request-view', requestId: r.ID })}
                    onKeyDown={(e) => { if (e.key === 'Enter') openWorkTab({ kind: 'request-view', requestId: r.ID }) }}>
                    {r.Label}
                  </span>
                ),
              },
              { header: 'Method', id: 'method', width: 'auto', renderCell: (r) => r.Method || 'GET' },
              { header: 'Auth', id: 'auth', width: 'auto', renderCell: (r) => AUTH_LABEL[r.AuthType] ?? r.AuthType },
              { header: 'URL', id: 'url', width: 'growCollapse', minWidth: '160px', renderCell: (r) => <TruncatedCell text={r.BaseURL} /> },
              {
                header: '', id: 'actions', width: 'auto', align: 'end',
                renderCell: (r) => (
                  <Stack direction="horizontal" gap="condensed">
                    <IconButton icon={PencilIcon} aria-label={`Edit ${r.Label}`} size="small" variant="invisible" onClick={() => openWorkTab({ kind: 'request-edit', requestId: r.ID })} />
                    <IconButton icon={DownloadIcon} aria-label={`Export ${r.Label}`} size="small" variant="invisible" onClick={() => exportRequest(r.ID, r.Label)} />
                    <IconButton icon={TrashIcon} aria-label={`Delete ${r.Label}`} size="small" variant="invisible" onClick={() => remove(r.ID)} />
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
          searchPlaceholder="Search integrations…"
          emptyState={{
            icon: PlugIcon,
            heading: 'No integrations yet',
            description: 'Call an external HTTP API with a typed request/response schema, auth, and headers.',
            action: newIntegrationMenu,
          }}
        />
      )}
    </PageContainer>
  )
}
