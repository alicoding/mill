import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, FormControl, IconButton, Select, Stack, Text, TextInput } from '@primer/react'
import { DownloadIcon, PencilIcon, PlusIcon, TerminalIcon, TrashIcon } from '@primer/octicons-react'
import { DataTable } from '@primer/react/experimental'
import { StatusStamp } from '../shared/StatusStamp'
import { ResizableTableContainer, TruncatedCell } from '../shared/ResizableTable'
import { ConfigureService } from '../shared/bindings'
import type { ExecEnv } from '../../bindings/github.com/alicoding/mill/internal/domain/execenv/models'
import { Shell, ProfileMode } from '../../bindings/github.com/alicoding/mill/internal/domain/execenv/models'
import { refreshExecEnvs, useConfigureEntityStore } from '../shared/configureEntityStore'
import { envToRows, execEnvAdvancedIsSet, rowsToEnv, type EnvRow } from './execEnvRows'
import { useViewMode } from '../shared/viewMode'
import { InventoryList, type InventoryItem } from '../shared/InventoryList'
import { entityRowContext } from '../shared/entityRowCommands'
import { useEntityActionError } from '../shared/entityActionErrorStore'
import { runCommand } from '../shared/commands'
import { ENTITY_ICON } from '../shared/entityIcons'
import { formatUpdated, sortByUpdatedDesc } from '../shared/inventorySort'
import { describeSeedReset } from '../shared/seedLifecycle'
import { useUISignalStore } from '../shared/uiSignalStore'
import { AdvancedDisclosure } from './AdvancedDisclosure'
import { EntityRefField } from './EntityRefField'
import { ConfigureEntityPage } from './ConfigureEntityPage'
import { useSeedLifecycle } from './useSeedLifecycle'
import { useEntityImportExport } from './useEntityImportExport'
import styles from '../shared/ListCard.module.css'

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
// ADR-0026's Amendment names. Page chrome (header row, import/export,
// seed lifecycle, view-mode switch, confirm dialogs) comes from the
// shared ConfigureEntityPage (docs/goals/0167); the form fields here
// stay hand-rolled (no typedfield.Field descriptor for ExecEnv yet --
// its env-var row editor and shell-capture action have no generic
// equivalent), only the list columns and this form are its own.
export function ConfigureExecEnv() {
  const { t } = useTranslation('configure')
  // A row action's refusal, recorded by the command that met it
  // (shared/entityActionErrorStore.ts, goal 0346).
  const rowActionError = useEntityActionError('execenv')
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
  const [environmentID, setEnvironmentID] = useState('')
  const [envRows, setEnvRows] = useState<EnvRow[]>([])
  const [formOpen, setFormOpen] = useState(false)
  const [capturing, setCapturing] = useState(false)
  const [error, setError] = useState('')
  const [viewMode, setViewMode] = useViewMode('mill-execenvs-view-mode')

  const seedLifecycle = useSeedLifecycle<ExecEnv>(() => ConfigureService.RestorableExecEnvs(), envs)

  const refetch = () => {
    void refreshExecEnvs()
  }

  const importExport = useEntityImportExport<ExecEnv>({
    existing: envs ?? [],
    exportEntity: (id) => ConfigureService.ExportExecEnv(id),
    importEntity: (text) => ConfigureService.ImportExecEnv(text),
    onImported: refetch,
    filenameFallback: 'execenv',
  })

  useEffect(() => {
    refetch()
    seedLifecycle.refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only fetch, same reasoning every sibling Configure page's identical effect documents
  }, [])

  const startCreate = () => {
    setEditingID(null)
    setLabel('')
    setShell(Shell.ShellZsh)
    setProfileMode(ProfileMode.ProfileClean)
    setDir(TEMP_DIR_SENTINEL)
    setEnvironmentID('')
    setEnvRows([{ key: '', value: '' }])
    setFormOpen(true)
    setError('')
  }

  // configure.new.execenvs (shared/configureCreateCommands.ts, goal
  // 0071 G6) -- same signal-consumption shape as ConfigureLists.tsx's
  // own configureCreateRequest effect.
  const configureCreateRequest = useUISignalStore((s) => s.configureCreateRequest)
  const consumeConfigureCreate = useUISignalStore((s) => s.consumeConfigureCreate)
  useEffect(() => {
    if (configureCreateRequest !== 'execenvs') return
    startCreate()
    consumeConfigureCreate()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- startCreate/consumeConfigureCreate deliberately excluded, same reasoning useCanvasCommandDispatch.ts's own identical effect documents
  }, [configureCreateRequest])

  const startEdit = (e: ExecEnv) => {
    setEditingID(e.ID)
    setLabel(e.Label)
    setShell(e.Shell)
    setProfileMode(e.ProfileMode)
    setDir(e.Dir)
    setEnvironmentID(e.EnvironmentID ?? '')
    setEnvRows(envToRows(e.Env))
    setFormOpen(true)
    setError('')
  }
  // goal 0312: a reference field's Open in Configure lands on THIS
  // entity's editor, once its list has loaded.
  const configureEditRequest = useUISignalStore((s) => s.configureEditRequest)
  const consumeConfigureEdit = useUISignalStore((s) => s.consumeConfigureEdit)
  useEffect(() => {
    if (configureEditRequest?.tab !== 'execenvs' || envs === null) return
    const target = envs.find((x) => x.ID === configureEditRequest.id)
    consumeConfigureEdit()
    if (target) startEdit(target)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- startEdit/consumeConfigureEdit deliberately excluded, same reasoning as the create effect above
  }, [configureEditRequest, envs])

  const save = async () => {
    setError('')
    try {
      const env = rowsToEnv(envRows)
      if (editingID) {
        await ConfigureService.UpdateExecEnv(editingID, label, shell, profileMode, dir, env, environmentID)
      } else {
        await ConfigureService.CreateExecEnv(label, shell, profileMode, dir, env, environmentID)
      }
      setFormOpen(false)
      refetch()
    } catch (err) {
      setError(String(err))
    }
  }

  // Table-view direct-wiring half of the Button-semantics convention
  // (.claude/rules/frontend.md) -- see ConfigureRequests.tsx's
  // identical comment.
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
    const seedReset = describeSeedReset(e.Seed, seedLifecycle.seedRevisions[e.ID] ?? e.Seed.SeedRevision)
    return {
      id: e.ID,
      entity: 'execenv',
      icon: ENTITY_ICON.execenv,
      label: e.Label,
      updatedLabel: formatUpdated(e.UpdatedAt),
      builtIn: e.BuiltIn,
      updatedAt: e.UpdatedAt,
      createdAt: e.CreatedAt,
      // No !e.BuiltIn guard on Delete -- same "ordinary, fully editable/
      // deletable from the moment it exists" reasoning as
      // ConfigureRequests.tsx/ConfigureLists.tsx's identical badge.
      labelBadges: e.BuiltIn ? <StatusStamp variant="identity">{t('builtIn')}</StatusStamp> : undefined,
      description: `${SHELL_LABEL[e.Shell] ?? e.Shell} · ${e.ProfileMode} · ${e.Dir === TEMP_DIR_SENTINEL ? t('configureExecEnv.freshTempDirPerRun') : e.Dir}`,
      onOpen: () => startEdit(e),
      menuActions: [
        { commandId: 'configure.execenv.export', ctx: entityRowContext('execenv', e.ID) },
        // Reset-to-shipped-example (docs/goals/0037 item 4): the command's
        // own enabled() hides it once the row matches the shipped golden,
        // so the row only names the revision it would restore.
        { commandId: 'configure.execenv.reset', ctx: entityRowContext('execenv', e.ID), label: seedReset.label },
        { commandId: 'configure.execenv.delete', ctx: entityRowContext('execenv', e.ID), danger: true },
      ],
    }
  })

  return (
    <ConfigureEntityPage
      pageTestId="configure-execenvs"
      headingId="execenvs-heading"
      headingText={t('configureExecEnv.heading')}
      viewMode={viewMode}
      onViewModeChange={setViewMode}
      importInputRef={importExport.importInputRef}
      importInputTestId="import-execenv-input"
      importTestId="import-execenv"
      onImportFile={importExport.handleImportFile}
      onImportClick={importExport.openImportPicker}
      importErrorNode={(importExport.importError ?? rowActionError) && (
        <Text as="p" size="small" className={styles.error} data-testid="import-execenv-error">{importExport.importError ?? rowActionError}</Text>
      )}
      restorable={seedLifecycle.restorable}
      onRestore={(id) => ConfigureService.RestoreExecEnv(id).then(() => { refetch(); seedLifecycle.refresh() }).catch((err) => importExport.setImportError(String(err)))}
      primaryLabel={t('configureExecEnv.newEnvironment')}
      primaryTestId="new-execenv"
      onPrimary={startCreate}
      formOpen={formOpen}
      formContent={(
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
          <AdvancedDisclosure open={execEnvAdvancedIsSet(dir, envRows, TEMP_DIR_SENTINEL)} testId="execenv-advanced">
          <FormControl>
            <FormControl.Label>{t('configureExecEnv.workingDirectory')}</FormControl.Label>
            <FormControl.Caption>{t('configureExecEnv.workingDirectoryCaption', { sentinel: TEMP_DIR_SENTINEL })}</FormControl.Caption>
            <TextInput value={dir} onChange={(e) => setDir(e.target.value)} block />
          </FormControl>
          {/* goal 0306 S5: a shell can borrow a shared Environment's
              variables instead of restating them; its own entries below
              still win on a shared name. */}
          <FormControl>
            <FormControl.Label>{t('configureEnvironments.environmentFromLabel')}</FormControl.Label>
            <FormControl.Caption>{t('configureEnvironments.environmentFromCaption')}</FormControl.Caption>
            <EntityRefField refKind="environment" value={environmentID} onChange={setEnvironmentID} />
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
          </AdvancedDisclosure>
          {error && <Text as="p" size="small" className={styles.error}>{error}</Text>}
          <Stack direction="horizontal" gap="condensed">
            <Button variant="primary" size="small" onClick={save}>{t('configureExecEnv.saveEnvironment')}</Button>
            <Button size="small" variant="invisible" onClick={() => setFormOpen(false)}>{t('entityRefField.cancel')}</Button>
          </Stack>
        </Stack>
      )}
      loading={envs === null}
      showTable={envs !== null && viewMode === 'table' && envs.length > 0}
      tableContent={(
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
                    <IconButton icon={DownloadIcon} aria-label={t('configureExecEnv.exportAriaLabel', { label: e.Label })} size="small" variant="invisible" onClick={() => void runCommand('configure.execenv.export', entityRowContext('execenv', e.ID))} />
                    <IconButton icon={TrashIcon} aria-label={t('configureExecEnv.deleteAriaLabel', { label: e.Label })} size="small" variant="invisible" onClick={() => void runCommand('configure.execenv.delete', entityRowContext('execenv', e.ID))} />
                  </Stack>
                ),
              },
            ]}
          />
        </ResizableTableContainer>
      )}
      showRows={envs !== null && viewMode === 'rows' && !(formOpen && envs.length === 0)}
      rowsContent={(
        <InventoryList
          listId="configure.execenv"
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
      importConfirmDialog={importExport.importConfirm.dialog}
    />
  )
}
