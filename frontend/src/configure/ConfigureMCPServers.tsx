import { useEffect, useMemo, useState } from 'react'
import { deleteWithUndo } from './deleteWithUndo'
import { useTranslation } from 'react-i18next'
import { Button, IconButton, Stack, Text, TextInput } from '@primer/react'
import { DownloadIcon, PencilIcon, PlusIcon, ServerIcon, TrashIcon } from '@primer/octicons-react'
import { DataTable } from '@primer/react/experimental'
import { StatusStamp } from '../shared/StatusStamp'
import { ResizableTableContainer, TruncatedCell } from '../shared/ResizableTable'
import { CopyDiagnosisButton } from '../shared/CopyDiagnosisButton'
import { ConfigureService } from '../shared/bindings'
import type { MCPServer } from '../../bindings/github.com/alicoding/mill/internal/domain/mcpserver/models'
import type { Tool } from '../../bindings/github.com/alicoding/mill/internal/adapters/mcpclient/models'
import type { Field } from '../../bindings/github.com/alicoding/mill/internal/domain/typedfield/models'
import { refreshMCPServers, useConfigureEntityStore } from '../shared/configureEntityStore'
import { useViewMode } from '../shared/viewMode'
import { InventoryList, type InventoryItem } from '../shared/InventoryList'
import { ENTITY_ICON } from '../shared/entityIcons'
import { formatUpdated, sortByUpdatedDesc } from '../shared/inventorySort'
import { describeSeedReset } from '../shared/seedLifecycle'
import { useUISignalStore } from '../shared/uiSignalStore'
import { EntityConfigFields } from './EntityConfigFields'
import { ConfigureEntityPage } from './ConfigureEntityPage'
import { useSeedLifecycle } from './useSeedLifecycle'
import { useEntityImportExport } from './useEntityImportExport'
import styles from '../shared/ListCard.module.css'

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
// from the menu instead of a dedicated button. Page chrome (header
// row, import/export, seed lifecycle, view-mode switch, confirm
// dialogs) comes from the shared ConfigureEntityPage (docs/goals/
// 0167); only the field set, list columns, and the tools panel below
// are this entity's own.
export function ConfigureMCPServers() {
  const { t } = useTranslation('configure')
  // Store-shared (refreshMCPServers, shared/configureEntityStore.ts) --
  // see ConfigureLists.tsx's identical comment (goal 0017 P1-1).
  const servers = useConfigureEntityStore((s) => s.mcpServers)
  const [fields, setFields] = useState<Field[]>([])
  const [editingID, setEditingID] = useState<string | null>(null)
  const [values, setValues] = useState<Record<string, string>>({ label: '', command: '' })
  const [argRows, setArgRows] = useState<string[]>([])
  // Env has no editor on this form yet (goal 0185 S3 shipped only the
  // Import/spawn-time path) -- carried through unedited so opening and
  // saving an existing server's form never drops a vault-ref entry it
  // already holds.
  const [env, setEnv] = useState<string[] | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [error, setError] = useState('')
  const [toolsByServer, setToolsByServer] = useState<Record<string, Tool[] | string>>({})
  const [viewMode, setViewMode] = useViewMode('mill-mcpservers-view-mode')

  const seedLifecycle = useSeedLifecycle<MCPServer>(() => ConfigureService.RestorableMCPServers())

  const refetch = () => {
    void refreshMCPServers()
  }

  const importExport = useEntityImportExport<MCPServer>({
    existing: servers ?? [],
    exportEntity: (id) => ConfigureService.ExportMCPServer(id),
    importEntity: (text) => ConfigureService.ImportMCPServer(text),
    onImported: refetch,
    filenameFallback: 'mcp-server',
  })

  useEffect(() => {
    refetch()
    seedLifecycle.refresh()
    ConfigureService.MCPServerFields().then((f) => setFields(f ?? [])).catch(console.error)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only fetch, same reasoning every sibling Configure page's identical effect documents
  }, [])

  const startCreate = () => {
    setEditingID(null)
    setValues({ label: '', command: '' })
    setArgRows([''])
    setEnv(null)
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
    setValues({ label: s.Label, command: s.Command })
    setArgRows(argsToRows(s.Args))
    setEnv(s.Env)
    setFormOpen(true)
    setError('')
  }
  // goal 0312: a reference field's Open in Configure lands on THIS
  // entity's editor, once its list has loaded.
  const configureEditRequest = useUISignalStore((s) => s.configureEditRequest)
  const consumeConfigureEdit = useUISignalStore((s) => s.consumeConfigureEdit)
  useEffect(() => {
    if (configureEditRequest?.tab !== 'mcpservers' || servers === null) return
    const target = servers.find((x) => x.ID === configureEditRequest.id)
    consumeConfigureEdit()
    if (target) startEdit(target)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- startEdit/consumeConfigureEdit deliberately excluded, same reasoning as the create effect above
  }, [configureEditRequest, servers])

  const setValue = (key: string, value: string) => setValues((prev) => ({ ...prev, [key]: value }))

  const save = async () => {
    setError('')
    try {
      const args = argRows.map((a) => a.trim()).filter(Boolean)
      if (editingID) {
        await ConfigureService.UpdateMCPServer(editingID, values.label, values.command, args, env)
      } else {
        await ConfigureService.CreateMCPServer(values.label, values.command, args, env)
      }
      setFormOpen(false)
      refetch()
    } catch (err) {
      setError(String(err))
    }
  }

  const remove = (id: string, label: string) => {
    void deleteWithUndo({ entity: 'mcpserver', id, label, remove: () => ConfigureService.DeleteMCPServer(id), refetch: () => {
      refetch()
      seedLifecycle.refresh()
    }, onError: (err) => importExport.setImportError(String(err)) })
  }

  // Reset-to-shipped-example / restore-deleted-example (docs/goals/0037
  // items 4/5).
  const resetToSeed = (id: string) => {
    ConfigureService.ResetMCPServerToSeed(id).then(() => {
      refetch()
      seedLifecycle.refresh()
    }).catch((err) => importExport.setImportError(String(err)))
  }

  // Table-view direct-wiring half of the Button-semantics convention
  // (.claude/rules/frontend.md) -- see ConfigureRequests.tsx's
  // identical comment.
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
    const seedReset = describeSeedReset(s.Seed, seedLifecycle.seedRevisions[s.ID] ?? s.Seed.SeedRevision)
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
        { label: t('export'), onClick: () => importExport.exportItem(s.ID, s.Label) },
        // Reset-to-shipped-example (docs/goals/0037 item 4) -- hidden
        // (not shown-disabled) when already current, same reasoning
        // CompositionView.tsx's identical wiring documents.
        ...(s.BuiltIn && !seedReset.disabled ? [{ label: seedReset.label, onClick: () => resetToSeed(s.ID) }] : []),
        {
          label: t('delete'),
          onClick: () => remove(s.ID, s.Label),
          danger: true,
        },
      ],
    }
  })

  // "List tools" (row menu action) renders its result here, below the
  // list -- one panel per server that's been queried, same shape the
  // old card view showed inline per-row, just no longer nested inside
  // the row itself now that Delete/Edit/List tools all moved into one
  // trailing ⋯ menu.
  const toolsPanels = Object.entries(toolsByServer).map(([id, result]) => {
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
  })

  return (
    <ConfigureEntityPage
      pageTestId="configure-mcpservers"
      headingId="mcpservers-heading"
      headingText={t('configureMCPServers.heading')}
      viewMode={viewMode}
      onViewModeChange={setViewMode}
      importInputRef={importExport.importInputRef}
      importInputTestId="import-mcpserver-input"
      importTestId="import-mcpserver"
      onImportFile={importExport.handleImportFile}
      onImportClick={importExport.openImportPicker}
      importErrorNode={importExport.importError && (
        <Stack direction="horizontal" gap="condensed" align="center">
          <Text as="p" size="small" className={styles.error} data-testid="import-mcpserver-error">{importExport.importError}</Text>
          <CopyDiagnosisButton error={importExport.importError} testId="import-mcpserver-copy-diagnosis" />
        </Stack>
      )}
      restorable={seedLifecycle.restorable}
      onRestore={(id) => ConfigureService.RestoreMCPServer(id).then(() => { refetch(); seedLifecycle.refresh() }).catch((err) => importExport.setImportError(String(err)))}
      primaryLabel={t('configureMCPServers.newMcpServer')}
      primaryTestId="new-mcpserver"
      onPrimary={startCreate}
      formOpen={formOpen}
      formContent={(
        <Stack direction="vertical" gap="condensed">
          <EntityConfigFields
            fields={fields}
            values={values}
            onChange={setValue}
            placeholders={{ command: t('configureMCPServers.commandPlaceholder') }}
          />
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
                context={{ 'Server label': values.label, Command: values.command }}
                testId="mcpserver-save-copy-diagnosis"
              />
            </Stack>
          )}
          <Stack direction="horizontal" gap="condensed">
            <Button variant="primary" size="small" onClick={save}>{t('configureMCPServers.saveMcpServer')}</Button>
            <Button size="small" variant="invisible" onClick={() => setFormOpen(false)}>{t('entityRefField.cancel')}</Button>
          </Stack>
        </Stack>
      )}
      loading={servers === null}
      showTable={servers !== null && viewMode === 'table' && servers.length > 0}
      tableContent={(
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
                    <IconButton icon={DownloadIcon} aria-label={t('configureMCPServers.exportAriaLabel', { label: s.Label })} size="small" variant="invisible" onClick={() => importExport.exportItem(s.ID, s.Label)} />
                    <IconButton icon={TrashIcon} aria-label={t('configureMCPServers.deleteAriaLabel', { label: s.Label })} size="small" variant="invisible" onClick={() => remove(s.ID, s.Label)} />
                  </Stack>
                ),
              },
            ]}
          />
        </ResizableTableContainer>
      )}
      showRows={servers !== null && viewMode === 'rows' && !(formOpen && servers.length === 0)}
      rowsContent={(
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
      importConfirmDialog={importExport.importConfirm.dialog}
      trailingContent={toolsPanels}
    />
  )
}
