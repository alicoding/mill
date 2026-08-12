import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, FormControl, Heading, IconButton, Label, Select, Stack, Text, TextInput } from '@primer/react'
import { DownloadIcon, PlusIcon, TerminalIcon, TrashIcon, UploadIcon } from '@primer/octicons-react'
import { DataTable } from '@primer/react/experimental'
import { ResizableTableContainer, TruncatedCell } from '../shared/ResizableTable'
import { ConfigureService } from '../shared/bindings'
import type { ExecEnv } from '../../bindings/github.com/alicoding/mill/internal/domain/execenv/models'
import { Shell, ProfileMode } from '../../bindings/github.com/alicoding/mill/internal/domain/execenv/models'
import { downloadJSON } from '../shared/downloadJSON'
import { refreshExecEnvs, useConfigureEntityStore } from '../shared/configureEntityStore'
import { envToRows, rowsToEnv, type EnvRow } from './execEnvRows'
import { ViewModeToggle } from '../shared/ViewModeToggle'
import { useViewMode } from '../shared/viewMode'
import { InventoryList, type InventoryItem } from '../shared/InventoryList'
import { ENTITY_ICON } from '../shared/entityIcons'
import { formatUpdated, sortByUpdatedDesc } from '../shared/inventorySort'
import { useConfirmDelete } from '../shared/useConfirmDelete'
import styles from '../shared/ListCard.module.css'
import PageContainer from '../shared/PageContainer'

const TEMP_DIR_SENTINEL = '<mill-temp>'

// Partial, not the full Record<Shell, string>/Record<ProfileMode,
// string> -- $zero (the Go zero value) is never a value a saved
// ExecEnv should carry (Validate rejects it), so every lookup below
// falls back to the raw string (`SHELL_LABEL[e.Shell] ?? e.Shell`)
// rather than forcing a meaningless "" -> label mapping into existence.
const SHELL_LABEL: Partial<Record<Shell, string>> = {
  [Shell.ShellZsh]: 'zsh',
  [Shell.ShellBash]: 'bash',
  [Shell.ShellSh]: 'sh',
}

const PROFILE_LABEL: Partial<Record<ProfileMode, string>> = {
  [ProfileMode.ProfileClean]: 'Clean (no shell profile, deterministic)',
  [ProfileMode.ProfileLogin]: 'Login (sources your shell profile)',
}

// The caption must describe the SELECTED mode, not always Clean -- a
// static caption showing Clean's semantics under a Login selection is
// the UI describing a state that isn't real (docs/SPEC.md §1's thesis),
// caught live from a screenshot. Wording matches execenv.go's own doc
// comments on ProfileClean/ProfileLogin.
const PROFILE_CAPTION: Partial<Record<ProfileMode, string>> = {
  [ProfileMode.ProfileClean]:
    'Fail-safe default -- no shell startup files are sourced; the step sees only the variables below.',
  [ProfileMode.ProfileLogin]:
    "Sources the shell's login startup files (.zprofile / .bash_profile) in addition to the variables below -- terminal parity, less deterministic.",
}

// Configure's Execution Environments section (docs/adr/0026,
// docs/SPEC.md §6): CRUD over ConfigureService's ExecEnvs, each a
// reusable, pinned shell/dir/env a code-execution workflow node
// resolves by ID -- the "materialize, don't inherit" Configure entity
// ADR-0026's Amendment names. Mirrors ConfigureMCPServers.tsx's shape
// (the Configure-entity recipe, docs/SPEC.md §9.5) closely: no
// secret/auth concept here at all, same as MCP Server.
export function ConfigureExecEnv() {
  // Store-shared (refreshExecEnvs, shared/configureEntityStore.ts) --
  // see ConfigureLists.tsx's identical comment (goal 0017 P1-1).
  const envs = useConfigureEntityStore((s) => s.execEnvs)
  const [editingID, setEditingID] = useState<string | null>(null)
  const [label, setLabel] = useState('')
  const [shell, setShell] = useState<Shell>(Shell.ShellZsh)
  const [profileMode, setProfileMode] = useState<ProfileMode>(ProfileMode.ProfileClean)
  const [dir, setDir] = useState(TEMP_DIR_SENTINEL)
  const [envRows, setEnvRows] = useState<EnvRow[]>([])
  const [formOpen, setFormOpen] = useState(false)
  const [capturing, setCapturing] = useState(false)
  const [error, setError] = useState('')
  const [importError, setImportError] = useState<string | null>(null)
  const importInputRef = useRef<HTMLInputElement>(null)
  const [viewMode, setViewMode] = useViewMode('mill-execenvs-view-mode')

  const refetch = () => {
    void refreshExecEnvs()
  }

  const exportEnv = (id: string, label: string) => {
    ConfigureService.ExportExecEnv(id)
      .then((json) => downloadJSON(`${label.trim() || 'execenv'}.json`, json))
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
      .then((text) => ConfigureService.ImportExecEnv(text))
      .then(() => { setImportError(null); refetch() })
      .catch((err) => setImportError(String(err)))
  }

  useEffect(refetch, [])

  const startCreate = () => {
    setEditingID(null)
    setLabel('')
    setShell(Shell.ShellZsh)
    setProfileMode(ProfileMode.ProfileClean)
    setDir(TEMP_DIR_SENTINEL)
    setEnvRows([{ key: '', value: '' }])
    setFormOpen(true)
    setError('')
  }

  const startEdit = (e: ExecEnv) => {
    setEditingID(e.ID)
    setLabel(e.Label)
    setShell(e.Shell)
    setProfileMode(e.ProfileMode)
    setDir(e.Dir)
    setEnvRows(envToRows(e.Env))
    setFormOpen(true)
    setError('')
  }

  const save = async () => {
    setError('')
    try {
      const env = rowsToEnv(envRows)
      if (editingID) {
        await ConfigureService.UpdateExecEnv(editingID, label, shell, profileMode, dir, env)
      } else {
        await ConfigureService.CreateExecEnv(label, shell, profileMode, dir, env)
      }
      setFormOpen(false)
      refetch()
    } catch (err) {
      setError(String(err))
    }
  }

  const remove = (id: string) => {
    ConfigureService.DeleteExecEnv(id).then(refetch).catch(console.error)
  }

  // Table-view direct-wiring half of the Button-semantics convention
  // (.claude/rules/frontend.md) -- see ConfigureRequests.tsx's
  // identical comment.
  const { requestDelete, dialog: confirmDialog } = useConfirmDelete<ExecEnv>({
    entityType: 'execution environment',
    labelOf: (e) => e.Label,
    onConfirm: (e) => remove(e.ID),
  })

  const updateEnvRow = (i: number, patch: Partial<EnvRow>) => {
    setEnvRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)))
  }

  const captureShellPath = async () => {
    setCapturing(true)
    setError('')
    try {
      const path = await ConfigureService.CaptureShellPath()
      setEnvRows((prev) => {
        const idx = prev.findIndex((r) => r.key.trim() === 'PATH')
        if (idx >= 0) return prev.map((r, i) => (i === idx ? { ...r, value: path } : r))
        const blankless = prev.filter((r) => r.key.trim() !== '' || r.value.trim() !== '')
        return [...blankless, { key: 'PATH', value: path }]
      })
    } catch (err) {
      setError(String(err))
    } finally {
      setCapturing(false)
    }
  }

  // Last-updated-first, applied once so both view modes render the
  // same order (docs/SPEC.md §3.8's InventoryList entry).
  const sortedEnvs = useMemo(() => sortByUpdatedDesc(envs ?? [], (e) => e.UpdatedAt), [envs])

  const envItems: InventoryItem[] = sortedEnvs.map((e) => ({
    id: e.ID,
    entity: 'execenv',
    icon: ENTITY_ICON.execenv,
    label: e.Label,
    updatedLabel: formatUpdated(e.UpdatedAt),
    // No !e.BuiltIn guard on Delete -- same "ordinary, fully editable/
    // deletable from the moment it exists" reasoning as
    // ConfigureRequests.tsx/ConfigureLists.tsx's identical badge.
    labelBadges: e.BuiltIn ? <Label variant="secondary" size="small">built-in</Label> : undefined,
    description: `${SHELL_LABEL[e.Shell] ?? e.Shell} · ${e.ProfileMode} · ${e.Dir === TEMP_DIR_SENTINEL ? 'fresh temp dir per run' : e.Dir}`,
    onOpen: () => startEdit(e),
    menuActions: [
      { label: 'Export', onClick: () => exportEnv(e.ID, e.Label) },
      {
        label: 'Delete',
        onClick: () => remove(e.ID),
        danger: true,
        confirm: { title: 'Delete execution environment?', body: `This permanently deletes "${e.Label}". This cannot be undone.` },
      },
    ],
  }))

  return (
    <PageContainer data-testid="configure-execenvs">
      <Stack direction="horizontal" justify="space-between" align="center" className={styles.sectionHeading}>
        <Heading as="h2" variant="small" id="execenvs-heading">Execution Environments</Heading>
        <Stack direction="horizontal" gap="condensed">
          <ViewModeToggle mode={viewMode} onChange={setViewMode} />
          <input
            ref={importInputRef}
            type="file"
            accept="application/json,.json"
            data-testid="import-execenv-input"
            style={{ display: 'none' }}
            onChange={handleImportFile}
          />
          <Button leadingVisual={UploadIcon} size="small" onClick={openImportPicker} data-testid="import-execenv">
            Import
          </Button>
          <Button leadingVisual={PlusIcon} variant="primary" size="small" onClick={startCreate} data-testid="new-execenv">
            New environment
          </Button>
        </Stack>
      </Stack>
      {importError && (
        <Text as="p" size="small" className={styles.error} data-testid="import-execenv-error">{importError}</Text>
      )}

      {formOpen && (
        <PageContainer variant="narrow">
        <div className={styles.card}>
          <Stack direction="vertical" gap="condensed">
            <FormControl>
              <FormControl.Label>Label</FormControl.Label>
              <TextInput value={label} onChange={(e) => setLabel(e.target.value)} block />
            </FormControl>
            <FormControl>
              <FormControl.Label>Shell</FormControl.Label>
              <Select value={shell} onChange={(e) => setShell(e.target.value as Shell)}>
                {Object.values(Shell).filter((s) => s !== Shell.$zero).map((s) => (
                  <Select.Option key={s} value={s}>{SHELL_LABEL[s] ?? s}</Select.Option>
                ))}
              </Select>
            </FormControl>
            <FormControl>
              <FormControl.Label>Profile mode</FormControl.Label>
              {/* data-testid on an inner span: FormControl.Caption doesn't
                  forward arbitrary props to its rendered element (checked
                  the hard way -- an e2e getByTestId found nothing). */}
              <FormControl.Caption><span data-testid="execenv-profile-caption">{PROFILE_CAPTION[profileMode] ?? ''}</span></FormControl.Caption>
              <Select value={profileMode} onChange={(e) => setProfileMode(e.target.value as ProfileMode)}>
                {Object.values(ProfileMode).filter((p) => p !== ProfileMode.$zero).map((p) => (
                  <Select.Option key={p} value={p}>{PROFILE_LABEL[p] ?? p}</Select.Option>
                ))}
              </Select>
            </FormControl>
            <FormControl>
              <FormControl.Label>Working directory</FormControl.Label>
              <FormControl.Caption>{`Use ${TEMP_DIR_SENTINEL} to mint a fresh, Mill-owned temp directory for each run, or a real absolute path.`}</FormControl.Caption>
              <TextInput value={dir} onChange={(e) => setDir(e.target.value)} block />
            </FormControl>
            <Text size="small" weight="semibold">Environment variables</Text>
            <FormControl.Caption>Explicit only -- never inherits Mill's own environment. Leave empty for a minimal default PATH.</FormControl.Caption>
            {envRows.map((row, i) => (
              <Stack key={i} direction="horizontal" gap="condensed" align="center">
                <TextInput
                  placeholder="PATH"
                  aria-label={`Variable ${i + 1} name`}
                  data-testid="execenv-env-key"
                  value={row.key}
                  onChange={(e) => updateEnvRow(i, { key: e.target.value })}
                  style={{ width: '30%' }}
                />
                <TextInput
                  placeholder="/usr/bin:/bin"
                  aria-label={`Variable ${i + 1} value`}
                  data-testid="execenv-env-value"
                  value={row.value}
                  onChange={(e) => updateEnvRow(i, { value: e.target.value })}
                  block
                />
                <IconButton
                  icon={TrashIcon}
                  aria-label="Remove variable"
                  size="small"
                  variant="invisible"
                  onClick={() => setEnvRows((prev) => prev.filter((_, idx) => idx !== i))}
                />
              </Stack>
            ))}
            <Stack direction="horizontal" gap="condensed">
              <Button size="small" variant="invisible" onClick={() => setEnvRows((prev) => [...prev, { key: '', value: '' }])}>
                Add variable
              </Button>
              {/* ADR-0026's Amendment, "Capture from my shell": snapshot the
                  real login-shell PATH into the stored, editable env --
                  determinism through materialization (clean mode AND your
                  Homebrew/mise paths, written down, never re-derived). */}
              <Button
                size="small"
                variant="invisible"
                loading={capturing}
                data-testid="capture-shell-path"
                onClick={captureShellPath}
              >
                Capture PATH from my shell
              </Button>
            </Stack>
            {error && <Text as="p" size="small" className={styles.error}>{error}</Text>}
            <Stack direction="horizontal" gap="condensed">
              <Button variant="primary" size="small" onClick={save}>Save environment</Button>
              <Button size="small" variant="invisible" onClick={() => setFormOpen(false)}>Cancel</Button>
            </Stack>
          </Stack>
        </div>
        </PageContainer>
      )}

      {envs === null && <Text as="p" className={styles.muted}>Loading…</Text>}
      {envs !== null && viewMode === 'table' && envs.length > 0 && (
        <ResizableTableContainer storageKey="mill-cols-execenvs">
          <DataTable
            aria-labelledby="execenvs-heading"
            data={sortedEnvs.map((e) => ({ ...e, id: e.ID }))}
            columns={[
              { header: 'Label', field: 'Label', rowHeader: true, sortBy: 'alphanumeric' },
              { header: 'Shell', id: 'shell', renderCell: (e) => SHELL_LABEL[e.Shell] ?? e.Shell },
              { header: 'Profile', field: 'ProfileMode' },
              { header: 'Dir', id: 'dir', width: 'growCollapse', minWidth: '160px', renderCell: (e) => <TruncatedCell text={e.Dir} /> },
              {
                header: '', id: 'actions', width: 'auto', align: 'end',
                renderCell: (e) => (
                  <Stack direction="horizontal" gap="condensed">
                    <Button size="small" variant="invisible" onClick={() => startEdit(e)}>Edit</Button>
                    <IconButton icon={DownloadIcon} aria-label={`Export ${e.Label}`} size="small" variant="invisible" onClick={() => exportEnv(e.ID, e.Label)} />
                    <IconButton icon={TrashIcon} aria-label={`Delete ${e.Label}`} size="small" variant="invisible" onClick={() => requestDelete(e)} />
                  </Stack>
                ),
              },
            ]}
          />
        </ResizableTableContainer>
      )}
      {envs !== null && viewMode === 'rows' && !(formOpen && envs.length === 0) && (
        <InventoryList
          items={envItems}
          searchPlaceholder="Search execution environments…"
          emptyState={{
            icon: TerminalIcon,
            heading: 'No execution environments yet',
            description: 'A reusable, pinned shell/directory/env a code-execution workflow node can run inside.',
            action: <Button leadingVisual={PlusIcon} variant="primary" onClick={startCreate}>New environment</Button>,
          }}
        />
      )}
      {confirmDialog}
    </PageContainer>
  )
}
