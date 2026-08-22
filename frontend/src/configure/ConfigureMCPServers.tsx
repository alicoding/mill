import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, FormControl, Heading, IconButton, Stack, Text, TextInput, VisuallyHidden } from '@primer/react'
import { DownloadIcon, PencilIcon, PlusIcon, ServerIcon, TrashIcon, UploadIcon } from '@primer/octicons-react'
import { DataTable } from '@primer/react/experimental'
import { StatusStamp } from '../shared/StatusStamp'
import { ResizableTableContainer, TruncatedCell } from '../shared/ResizableTable'
import { CopyDiagnosisButton } from '../shared/CopyDiagnosisButton'
import { ConfigureService } from '../shared/bindings'
import type { MCPServer } from '../../bindings/github.com/alicoding/mill/internal/domain/mcpserver/models'
import type { Tool } from '../../bindings/github.com/alicoding/mill/internal/adapters/mcpclient/models'
import { downloadJSON } from '../shared/downloadJSON'
import { refreshMCPServers, useConfigureEntityStore } from '../shared/configureEntityStore'
import { ViewModeToggle } from '../shared/ViewModeToggle'
import { useViewMode } from '../shared/viewMode'
import { InventoryList, type InventoryItem } from '../shared/InventoryList'
import { ENTITY_ICON } from '../shared/entityIcons'
import { formatUpdated, sortByUpdatedDesc } from '../shared/inventorySort'
import { useConfirmDelete } from '../shared/useConfirmDelete'
import { useImportConfirm } from '../shared/useImportConfirm'
import { describeSeedReset } from '../shared/seedLifecycle'
import { RestoreExamplesButton } from '../shared/RestoreExamplesButton'
import { useUISignalStore } from '../shared/uiSignalStore'
import styles from '../shared/ListCard.module.css'
import PageContainer from '../shared/PageContainer'

function argsToRows(args: string[] | null | undefined): string[] {
  return args && args.length > 0 ? args : ['']
}

// Configure's MCP Servers section (docs/SPEC.md §3.6): CRUD over
// ConfigureService's MCPServers, each a reusable stdio connection an
// mcp-tool-call node resolves by ID. "List tools" is this feature's
// actual discoverability value -- a user finds the exact toolName (and
// its expected arguments, from the raw InputSchema) to paste into a
// workflow node here, not by guessing.
//
// Rows are the DEFAULT view (docs/goals/0007): InventoryList's shared
// row replaces the old hand-rolled card branch. Row click edits;
// List tools/Export/Delete move into the trailing ⋯ menu -- "List
// tools" keeps its exact prior behavior (fetch, render inline below
// the list, one panel per server that's been queried), just triggered
// from the menu instead of a dedicated button.
export function ConfigureMCPServers() {
  const { t } = useTranslation('configure')
  // Store-shared (refreshMCPServers, shared/configureEntityStore.ts) --
  // see ConfigureLists.tsx's identical comment (goal 0017 P1-1).
  const servers = useConfigureEntityStore((s) => s.mcpServers)
  const [editingID, setEditingID] = useState<string | null>(null)
  const [label, setLabel] = useState('')
  const [command, setCommand] = useState('')
  const [argRows, setArgRows] = useState<string[]>([])
  const [formOpen, setFormOpen] = useState(false)
  const [error, setError] = useState('')
  const [toolsByServer, setToolsByServer] = useState<Record<string, Tool[] | string>>({})
  const [importError, setImportError] = useState<string | null>(null)
  const importInputRef = useRef<HTMLInputElement>(null)
  const [viewMode, setViewMode] = useViewMode('mill-mcpservers-view-mode')
  // Seed lifecycle (docs/goals/0037) -- see CompositionView.tsx's
  // identical state for the full reasoning.
  const [seedRevisions, setSeedRevisions] = useState<Record<string, number | undefined>>({})
  const [restorable, setRestorable] = useState<MCPServer[]>([])

  const refreshSeedLifecycle = () => {
    ConfigureService.SeedRevisions().then((m) => setSeedRevisions(m ?? {})).catch(console.error)
    ConfigureService.RestorableMCPServers().then((r) => setRestorable(r ?? [])).catch(console.error)
  }

  const refetch = () => {
    void refreshMCPServers()
  }

  const exportServer = (id: string, label: string) => {
    ConfigureService.ExportMCPServer(id)
      .then((json) => downloadJSON(`${label.trim() || 'mcp-server'}.json`, json))
      .catch((err) => setImportError(String(err)))
  }

  const openImportPicker = () => {
    setImportError(null)
    importInputRef.current?.click()
  }

  // A payload whose id matches a server already here updates it in
  // place instead of creating a new one -- confirmed first via
  // importConfirm below, naming the server it will replace.
  const runImport = (text: string) => {
    ConfigureService.ImportMCPServer(text)
      .then(() => { setImportError(null); refetch() })
      .catch((err) => setImportError(String(err)))
  }
  const importConfirm = useImportConfirm({ existing: servers ?? [], onImport: runImport })
  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    file.text().then(importConfirm.requestImport).catch((err) => setImportError(String(err)))
  }

  useEffect(() => {
    refetch()
    refreshSeedLifecycle()
  }, [])

  const startCreate = () => {
    setEditingID(null)
    setLabel('')
    setCommand('')
    setArgRows([''])
    setFormOpen(true)
    setError('')
  }

  // configure.new.mcpservers (shared/configureCreateCommands.ts, goal
  // 0071 G6) -- same signal-consumption shape as ConfigureLists.tsx's
  // own configureCreateRequest effect.
  const configureCreateRequest = useUISignalStore((s) => s.configureCreateRequest)
  const consumeConfigureCreate = useUISignalStore((s) => s.consumeConfigureCreate)
  useEffect(() => {
    if (configureCreateRequest !== 'mcpservers') return
    startCreate()
    consumeConfigureCreate()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- startCreate/consumeConfigureCreate deliberately excluded, same reasoning useCanvasCommandDispatch.ts's own identical effect documents
  }, [configureCreateRequest])

  const startEdit = (s: MCPServer) => {
    setEditingID(s.ID)
    setLabel(s.Label)
    setCommand(s.Command)
    setArgRows(argsToRows(s.Args))
    setFormOpen(true)
    setError('')
  }

  const save = async () => {
    setError('')
    try {
      const args = argRows.map((a) => a.trim()).filter(Boolean)
      if (editingID) {
        await ConfigureService.UpdateMCPServer(editingID, label, command, args)
      } else {
        await ConfigureService.CreateMCPServer(label, command, args)
      }
      setFormOpen(false)
      refetch()
    } catch (err) {
      setError(String(err))
    }
  }

  const remove = (id: string) => {
    ConfigureService.DeleteMCPServer(id).then(() => {
      refetch()
      refreshSeedLifecycle()
    }).catch((err) => setImportError(String(err)))
  }

  // Reset-to-shipped-example / restore-deleted-example (docs/goals/0037
  // items 4/5).
  const resetToSeed = (id: string) => {
    ConfigureService.ResetMCPServerToSeed(id).then(() => {
      refetch()
      refreshSeedLifecycle()
    }).catch((err) => setImportError(String(err)))
  }
  const restoreExample = (id: string) => {
    ConfigureService.RestoreMCPServer(id).then(() => {
      refetch()
      refreshSeedLifecycle()
    }).catch((err) => setImportError(String(err)))
  }

  // Table-view direct-wiring half of the Button-semantics convention
  // (.claude/rules/frontend.md) -- see ConfigureRequests.tsx's
  // identical comment.
  const { requestDelete, dialog: confirmDialog } = useConfirmDelete<MCPServer>({
    entityType: 'MCP server',
    labelOf: (s) => s.Label,
    onConfirm: (s) => remove(s.ID),
  })

  const listTools = (id: string) => {
    ConfigureService.ListMCPServerTools(id)
      .then((tools) => setToolsByServer((prev) => ({ ...prev, [id]: tools ?? [] })))
      .catch((err) => setToolsByServer((prev) => ({ ...prev, [id]: String(err) })))
  }

  const updateArgRow = (i: number, value: string) => {
    setArgRows((prev) => prev.map((a, idx) => (idx === i ? value : a)))
  }

  // Last-updated-first, applied once so both view modes render the
  // same order (docs/SPEC.md §3.8's InventoryList entry).
  const sortedServers = useMemo(() => sortByUpdatedDesc(servers ?? [], (s) => s.UpdatedAt), [servers])

  const serverItems: InventoryItem[] = sortedServers.map((s) => {
    const seedReset = describeSeedReset(s.Seed, seedRevisions[s.ID] ?? s.Seed.SeedRevision)
    return {
      id: s.ID,
      entity: 'mcpserver',
      icon: ENTITY_ICON.mcpserver,
      label: s.Label,
      updatedLabel: formatUpdated(s.UpdatedAt),
      // No !s.BuiltIn guard on Delete -- same "ordinary, fully editable/
      // deletable from the moment it exists" reasoning as
      // ConfigureRequests.tsx/ConfigureLists.tsx's identical badge.
      labelBadges: s.BuiltIn ? <StatusStamp variant="identity">{t('builtIn')}</StatusStamp> : undefined,
      description: `${s.Command} ${(s.Args ?? []).join(' ')}`.trim(),
      onOpen: () => startEdit(s),
      menuActions: [
        { label: t('configureMCPServers.listTools'), onClick: () => listTools(s.ID) },
        { label: t('export'), onClick: () => exportServer(s.ID, s.Label) },
        // Reset-to-shipped-example (docs/goals/0037 item 4) -- hidden
        // (not shown-disabled) when already current, same reasoning
        // CompositionView.tsx's identical wiring documents.
        ...(s.BuiltIn && !seedReset.disabled ? [{ label: seedReset.label, onClick: () => resetToSeed(s.ID) }] : []),
        {
          label: t('delete'),
          onClick: () => remove(s.ID),
          danger: true,
          confirm: { title: t('configureMCPServers.deleteConfirmTitle'), body: t('configureMCPServers.deleteConfirmBody', { label: s.Label }) },
        },
      ],
    }
  })

  return (
    <PageContainer data-testid="configure-mcpservers">
      <Stack direction="horizontal" justify="end" align="center" className={styles.sectionHeading}>
        {/* Design-wave-1 fix #6: the Configure tab already names this
            section -- visually hidden (not removed) so the aria-labelledby
            wiring below and the a11y heading structure both stay intact. */}
        <VisuallyHidden>
          <Heading as="h2" variant="small" id="mcpservers-heading">{t('configureMCPServers.heading')}</Heading>
        </VisuallyHidden>
        <Stack direction="horizontal" gap="condensed">
          <ViewModeToggle mode={viewMode} onChange={setViewMode} />
          <input
            ref={importInputRef}
            type="file"
            accept="application/json,.json"
            data-testid="import-mcpserver-input"
            style={{ display: 'none' }}
            onChange={handleImportFile}
          />
          <Button leadingVisual={UploadIcon} size="small" onClick={openImportPicker} data-testid="import-mcpserver">
            {t('import')}
          </Button>
          <RestoreExamplesButton items={restorable} onRestore={restoreExample} />
          <Button leadingVisual={PlusIcon} variant="primary" size="small" onClick={startCreate} data-testid="new-mcpserver">
            {t('configureMCPServers.newMcpServer')}
          </Button>
        </Stack>
      </Stack>
      {importError && (
        <Stack direction="horizontal" gap="condensed" align="center">
          <Text as="p" size="small" className={styles.error} data-testid="import-mcpserver-error">{importError}</Text>
          <CopyDiagnosisButton error={importError} testId="import-mcpserver-copy-diagnosis" />
        </Stack>
      )}

      {formOpen && (
        <PageContainer variant="narrow">
        <div className={styles.card}>
          <Stack direction="vertical" gap="condensed">
            <FormControl>
              <FormControl.Label>{t('configureMCPServers.label')}</FormControl.Label>
              <TextInput value={label} onChange={(e) => setLabel(e.target.value)} block />
            </FormControl>
            <FormControl>
              <FormControl.Label>{t('configureMCPServers.command')}</FormControl.Label>
              <FormControl.Caption>{t('configureMCPServers.commandCaption')}</FormControl.Caption>
              <TextInput value={command} onChange={(e) => setCommand(e.target.value)} placeholder={t('configureMCPServers.commandPlaceholder')} block />
            </FormControl>
            <Text size="small" weight="semibold">{t('configureMCPServers.arguments')}</Text>
            {argRows.map((arg, i) => (
              <Stack key={i} direction="horizontal" gap="condensed" align="center">
                <TextInput placeholder={t('configureMCPServers.argPlaceholder')} value={arg} onChange={(e) => updateArgRow(i, e.target.value)} />
                <IconButton
                  icon={TrashIcon}
                  aria-label={t('configureMCPServers.removeArgumentAriaLabel')}
                  size="small"
                  variant="invisible"
                  onClick={() => setArgRows((prev) => prev.filter((_, idx) => idx !== i))}
                />
              </Stack>
            ))}
            <Button size="small" variant="invisible" onClick={() => setArgRows((prev) => [...prev, ''])}>
              {t('configureMCPServers.addArgument')}
            </Button>
            {error && (
              <Stack direction="horizontal" gap="condensed" align="center">
                <Text as="p" size="small" className={styles.error}>{error}</Text>
                <CopyDiagnosisButton
                  error={error}
                  context={{ 'Server label': label, Command: command }}
                  testId="mcpserver-save-copy-diagnosis"
                />
              </Stack>
            )}
            <Stack direction="horizontal" gap="condensed">
              <Button variant="primary" size="small" onClick={save}>{t('configureMCPServers.saveMcpServer')}</Button>
              <Button size="small" variant="invisible" onClick={() => setFormOpen(false)}>{t('entityRefField.cancel')}</Button>
            </Stack>
          </Stack>
        </div>
        </PageContainer>
      )}

      {servers === null && <Text as="p" className={styles.muted}>{t('loading')}</Text>}
      {servers !== null && viewMode === 'table' && servers.length > 0 && (
        <ResizableTableContainer storageKey="mill-cols-mcpservers">
          <DataTable
            aria-labelledby="mcpservers-heading"
            data={sortedServers.map((s) => ({ ...s, id: s.ID }))}
            columns={[
              { header: t('configureMCPServers.columns.label'), field: 'Label', rowHeader: true, sortBy: 'alphanumeric' },
              { header: t('configureMCPServers.columns.command'), id: 'command', width: 'growCollapse', minWidth: '160px', renderCell: (s) => <TruncatedCell text={`${s.Command} ${(s.Args ?? []).join(' ')}`.trim()} mono /> },
              { header: t('configureMCPServers.columns.id'), field: 'ID' },
              {
                header: '', id: 'actions', width: 'auto', align: 'end',
                renderCell: (s) => (
                  <Stack direction="horizontal" gap="condensed">
                    <Button size="small" variant="invisible" onClick={() => listTools(s.ID)}>{t('configureMCPServers.listTools')}</Button>
                    <IconButton icon={PencilIcon} aria-label={t('configureMCPServers.editAriaLabel', { label: s.Label })} size="small" variant="invisible" onClick={() => startEdit(s)} />
                    <IconButton icon={DownloadIcon} aria-label={t('configureMCPServers.exportAriaLabel', { label: s.Label })} size="small" variant="invisible" onClick={() => exportServer(s.ID, s.Label)} />
                    <IconButton icon={TrashIcon} aria-label={t('configureMCPServers.deleteAriaLabel', { label: s.Label })} size="small" variant="invisible" onClick={() => requestDelete(s)} />
                  </Stack>
                ),
              },
            ]}
          />
        </ResizableTableContainer>
      )}
      {servers !== null && viewMode === 'rows' && !(formOpen && servers.length === 0) && (
        <InventoryList
          items={serverItems}
          searchPlaceholder={t('configureMCPServers.searchPlaceholder')}
          emptyState={{
            icon: ServerIcon,
            heading: t('configureMCPServers.emptyHeading'),
            description: t('configureMCPServers.emptyDescription'),
            action: <Button leadingVisual={PlusIcon} variant="primary" onClick={startCreate}>{t('configureMCPServers.newMcpServer')}</Button>,
          }}
        />
      )}
      {confirmDialog}
      {importConfirm.dialog}

      {/* "List tools" (row menu action) renders its result here, below
          the list -- one panel per server that's been queried, same
          shape the old card view showed inline per-row, just no longer
          nested inside the row itself now that Delete/Edit/List tools
          all moved into one trailing ⋯ menu. */}
      {Object.entries(toolsByServer).map(([id, result]) => {
        const server = servers?.find((s) => s.ID === id)
        return (
          <div key={id} className={styles.card} data-testid="mcpserver-tools">
            <Text weight="semibold" size="small">{t('configureMCPServers.serverTools', { label: server?.Label ?? id })}</Text>
            {typeof result === 'string' ? (
              <Stack direction="horizontal" gap="condensed" align="center">
                <Text as="p" size="small" className={styles.error}>{result}</Text>
                <CopyDiagnosisButton
                  error={result}
                  context={{ 'Server label': server?.Label, Command: server?.Command }}
                  testId="mcpserver-tools-copy-diagnosis"
                />
              </Stack>
            ) : result.length === 0 ? (
              <Text as="p" size="small" className={styles.muted}>{t('configureMCPServers.noToolsExposed')}</Text>
            ) : (
              <Stack direction="vertical" gap="condensed">
                {(result as Tool[]).map((tool) => (
                  <div key={tool.Name}>
                    <Text weight="semibold" size="small">{tool.Name}</Text>
                    <Text as="p" size="small" className={styles.muted}>{tool.Description}</Text>
                    <pre className={styles.result}>{JSON.stringify(tool.InputSchema, null, 2)}</pre>
                  </div>
                ))}
              </Stack>
            )}
          </div>
        )
      })}
    </PageContainer>
  )
}
