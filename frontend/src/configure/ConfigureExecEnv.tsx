import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, FormControl, Heading, IconButton, Select, Stack, Text, TextInput, VisuallyHidden } from '@primer/react'
import { DownloadIcon, PencilIcon, PlusIcon, TerminalIcon, TrashIcon, UploadIcon } from '@primer/octicons-react'
import { DataTable } from '@primer/react/experimental'
import { StatusStamp } from '../shared/StatusStamp'
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
import { describeSeedReset } from '../shared/seedLifecycle'
import { RestoreExamplesButton } from '../shared/RestoreExamplesButton'
import styles from '../shared/ListCard.module.css'
import PageContainer from '../shared/PageContainer'

const TEMP_DIR_SENTINEL = '<mill-temp>'

// Partial, not the full Record<Shell, string>/Record<ProfileMode,
// string> -- $zero (the Go zero value) is never a value a saved
// ExecEnv should carry (Validate rejects it), so every lookup below
// falls back to the raw string (`SHELL_LABEL[e.Shell] ?? e.Shell`)
// rather than forcing a meaningless "" -> label mapping into existence.
function shellLabelFor(t: (key: string) => string): Partial<Record<Shell, string>> {
  return {
    [Shell.ShellZsh]: t('configureExecEnv.shellLabel.zsh'),
    [Shell.ShellBash]: t('configureExecEnv.shellLabel.bash'),
    [Shell.ShellSh]: t('configureExecEnv.shellLabel.sh'),
  }
}

function profileLabelFor(t: (key: string) => string): Partial<Record<ProfileMode, string>> {
  return {
    [ProfileMode.ProfileClean]: t('configureExecEnv.profileLabel.clean'),
    [ProfileMode.ProfileLogin]: t('configureExecEnv.profileLabel.login'),
  }
}

// The caption must describe the SELECTED mode, not always Clean -- a
// static caption showing Clean's semantics under a Login selection is
// the UI describing a state that isn't real (docs/SPEC.md §1's thesis).
// Wording matches execenv.go's own doc
// comments on ProfileClean/ProfileLogin.
function profileCaptionFor(t: (key: string) => string): Partial<Record<ProfileMode, string>> {
  return {
    [ProfileMode.ProfileClean]: t('configureExecEnv.profileCaption.clean'),
    [ProfileMode.ProfileLogin]: t('configureExecEnv.profileCaption.login'),
  }
}

// Configure's Execution Environments section (docs/adr/0026,
// docs/SPEC.md §6): CRUD over ConfigureService's ExecEnvs, each a
// reusable, pinned shell/dir/env a code-execution workflow node
// resolves by ID -- the "materialize, don't inherit" Configure entity
// ADR-0026's Amendment names. Mirrors ConfigureMCPServers.tsx's shape
// (the Configure-entity recipe, docs/SPEC.md §9.5) closely: no
// secret/auth concept here at all, same as MCP Server.
export function ConfigureExecEnv() {
  const { t } = useTranslation('configure')
  const SHELL_LABEL = shellLabelFor(t)
  const PROFILE_LABEL = profileLabelFor(t)
  const PROFILE_CAPTION = profileCaptionFor(t)
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
  // Seed lifecycle (docs/goals/0037) -- see CompositionView.tsx's
  // identical state for the full reasoning.
  const [seedRevisions, setSeedRevisions] = useState<Record<string, number | undefined>>({})
  const [restorable, setRestorable] = useState<ExecEnv[]>([])

  const refreshSeedLifecycle = () => {
    ConfigureService.SeedRevisions().then((m) => setSeedRevisions(m ?? {})).catch(console.error)
    ConfigureService.RestorableExecEnvs().then((r) => setRestorable(r ?? [])).catch(console.error)
  }

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

  useEffect(() => {
    refetch()
    refreshSeedLifecycle()
  }, [])

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
    ConfigureService.DeleteExecEnv(id).then(() => {
      refetch()
      refreshSeedLifecycle()
    }).catch(console.error)
  }

  // Reset-to-shipped-example / restore-deleted-example (docs/goals/0037
  // items 4/5).
  const resetToSeed = (id: string) => {
    ConfigureService.ResetExecEnvToSeed(id).then(() => {
      refetch()
      refreshSeedLifecycle()
    }).catch((err) => setImportError(String(err)))
  }
  const restoreExample = (id: string) => {
    ConfigureService.RestoreExecEnv(id).then(() => {
      refetch()
      refreshSeedLifecycle()
    }).catch((err) => setImportError(String(err)))
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

  const envItems: InventoryItem[] = sortedEnvs.map((e) => {
    const seedReset = describeSeedReset(e.Seed, seedRevisions[e.ID] ?? e.Seed.SeedRevision)
    return {
      id: e.ID,
      entity: 'execenv',
      icon: ENTITY_ICON.execenv,
      label: e.Label,
      updatedLabel: formatUpdated(e.UpdatedAt),
      // No !e.BuiltIn guard on Delete -- same "ordinary, fully editable/
      // deletable from the moment it exists" reasoning as
      // ConfigureRequests.tsx/ConfigureLists.tsx's identical badge.
      labelBadges: e.BuiltIn ? <StatusStamp variant="identity">{t('builtIn')}</StatusStamp> : undefined,
      description: `${SHELL_LABEL[e.Shell] ?? e.Shell} · ${e.ProfileMode} · ${e.Dir === TEMP_DIR_SENTINEL ? t('configureExecEnv.freshTempDirPerRun') : e.Dir}`,
      onOpen: () => startEdit(e),
      menuActions: [
        { label: t('export'), onClick: () => exportEnv(e.ID, e.Label) },
        // Reset-to-shipped-example (docs/goals/0037 item 4) -- hidden
        // (not shown-disabled) when already current, same reasoning
        // CompositionView.tsx's identical wiring documents.
        ...(e.BuiltIn && !seedReset.disabled ? [{ label: seedReset.label, onClick: () => resetToSeed(e.ID) }] : []),
        {
          label: t('delete'),
          onClick: () => remove(e.ID),
          danger: true,
          confirm: { title: t('configureExecEnv.deleteConfirmTitle'), body: t('configureExecEnv.deleteConfirmBody', { label: e.Label }) },
        },
      ],
    }
  })

  return (
    <PageContainer data-testid="configure-execenvs">
      <Stack direction="horizontal" justify="end" align="center" className={styles.sectionHeading}>
        {/* Design-wave-1 fix #6: the Configure tab already names this
            section -- visually hidden (not removed) so the aria-labelledby
            wiring below and the a11y heading structure both stay intact. */}
        <VisuallyHidden>
          <Heading as="h2" variant="small" id="execenvs-heading">{t('configureExecEnv.heading')}</Heading>
        </VisuallyHidden>
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
            {t('import')}
          </Button>
          <RestoreExamplesButton items={restorable} onRestore={restoreExample} />
          <Button leadingVisual={PlusIcon} variant="primary" size="small" onClick={startCreate} data-testid="new-execenv">
            {t('configureExecEnv.newEnvironment')}
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
              <FormControl.Label>{t('configureExecEnv.label')}</FormControl.Label>
              <TextInput value={label} onChange={(e) => setLabel(e.target.value)} block />
            </FormControl>
            <FormControl>
              <FormControl.Label>{t('configureExecEnv.shell')}</FormControl.Label>
              <Select value={shell} onChange={(e) => setShell(e.target.value as Shell)}>
                {Object.values(Shell).filter((s) => s !== Shell.$zero).map((s) => (
                  <Select.Option key={s} value={s}>{SHELL_LABEL[s] ?? s}</Select.Option>
                ))}
              </Select>
            </FormControl>
            <FormControl>
              <FormControl.Label>{t('configureExecEnv.profileMode')}</FormControl.Label>
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
              <FormControl.Label>{t('configureExecEnv.workingDirectory')}</FormControl.Label>
              <FormControl.Caption>{t('configureExecEnv.workingDirectoryCaption', { sentinel: TEMP_DIR_SENTINEL })}</FormControl.Caption>
              <TextInput value={dir} onChange={(e) => setDir(e.target.value)} block />
            </FormControl>
            <Text size="small" weight="semibold">{t('configureExecEnv.environmentVariables')}</Text>
            <FormControl.Caption>{t('configureExecEnv.environmentVariablesCaption')}</FormControl.Caption>
            {envRows.map((row, i) => (
              <Stack key={i} direction="horizontal" gap="condensed" align="center">
                <TextInput
                  placeholder={t('configureExecEnv.pathPlaceholder')}
                  aria-label={t('configureExecEnv.variableNameAriaLabel', { n: i + 1 })}
                  data-testid="execenv-env-key"
                  value={row.key}
                  onChange={(e) => updateEnvRow(i, { key: e.target.value })}
                  style={{ width: '30%' }}
                />
                <TextInput
                  placeholder={t('configureExecEnv.pathValuePlaceholder')}
                  aria-label={t('configureExecEnv.variableValueAriaLabel', { n: i + 1 })}
                  data-testid="execenv-env-value"
                  value={row.value}
                  onChange={(e) => updateEnvRow(i, { value: e.target.value })}
                  block
                />
                <IconButton
                  icon={TrashIcon}
                  aria-label={t('configureExecEnv.removeVariableAriaLabel')}
                  size="small"
                  variant="invisible"
                  onClick={() => setEnvRows((prev) => prev.filter((_, idx) => idx !== i))}
                />
              </Stack>
            ))}
            <Stack direction="horizontal" gap="condensed">
              <Button size="small" variant="invisible" onClick={() => setEnvRows((prev) => [...prev, { key: '', value: '' }])}>
                {t('configureExecEnv.addVariable')}
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
                {t('configureExecEnv.capturePathFromShell')}
              </Button>
            </Stack>
            {error && <Text as="p" size="small" className={styles.error}>{error}</Text>}
            <Stack direction="horizontal" gap="condensed">
              <Button variant="primary" size="small" onClick={save}>{t('configureExecEnv.saveEnvironment')}</Button>
              <Button size="small" variant="invisible" onClick={() => setFormOpen(false)}>{t('entityRefField.cancel')}</Button>
            </Stack>
          </Stack>
        </div>
        </PageContainer>
      )}

      {envs === null && <Text as="p" className={styles.muted}>{t('loading')}</Text>}
      {envs !== null && viewMode === 'table' && envs.length > 0 && (
        <ResizableTableContainer storageKey="mill-cols-execenvs">
          <DataTable
            aria-labelledby="execenvs-heading"
            data={sortedEnvs.map((e) => ({ ...e, id: e.ID }))}
            columns={[
              { header: t('configureExecEnv.columns.label'), field: 'Label', rowHeader: true, sortBy: 'alphanumeric' },
              { header: t('configureExecEnv.columns.shell'), id: 'shell', renderCell: (e) => SHELL_LABEL[e.Shell] ?? e.Shell },
              { header: t('configureExecEnv.columns.profile'), field: 'ProfileMode' },
              { header: t('configureExecEnv.columns.dir'), id: 'dir', width: 'growCollapse', minWidth: '160px', renderCell: (e) => <TruncatedCell text={e.Dir} mono /> },
              {
                header: '', id: 'actions', width: 'auto', align: 'end',
                renderCell: (e) => (
                  <Stack direction="horizontal" gap="condensed">
                    <IconButton icon={PencilIcon} aria-label={t('configureExecEnv.editAriaLabel', { label: e.Label })} size="small" variant="invisible" onClick={() => startEdit(e)} />
                    <IconButton icon={DownloadIcon} aria-label={t('configureExecEnv.exportAriaLabel', { label: e.Label })} size="small" variant="invisible" onClick={() => exportEnv(e.ID, e.Label)} />
                    <IconButton icon={TrashIcon} aria-label={t('configureExecEnv.deleteAriaLabel', { label: e.Label })} size="small" variant="invisible" onClick={() => requestDelete(e)} />
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
          searchPlaceholder={t('configureExecEnv.searchPlaceholder')}
          emptyState={{
            icon: TerminalIcon,
            heading: t('configureExecEnv.emptyHeading'),
            description: t('configureExecEnv.emptyDescription'),
            action: <Button leadingVisual={PlusIcon} variant="primary" onClick={startCreate}>{t('configureExecEnv.newEnvironment')}</Button>,
          }}
        />
      )}
      {confirmDialog}
    </PageContainer>
  )
}
