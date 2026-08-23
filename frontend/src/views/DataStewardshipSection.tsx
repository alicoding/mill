import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Events } from '@wailsio/runtime'
import { Button, FormControl, Stack, Text } from '@primer/react'
import { DownloadIcon, FileDirectoryIcon, UploadIcon } from '@primer/octicons-react'
import { BackupService } from '../shared/bindings'
import type { BackupStatus, ImportEverythingSummary } from '../shared/bindings'
import { ConfirmDialog } from '../shared/ConfirmDialog'
import { CopyDiagnosisButton } from '../shared/CopyDiagnosisButton'
import { base64ToBlob } from '../shared/base64Blob'
import { downloadBlob } from '../shared/downloadBlob'
import styles from '../shared/ListCard.module.css'

// Extracted from SettingsView.tsx (same reason KeyboardShortcutsSection
// already is: keeps that file's own line count from crowding the
// 500-line convention). docs/goals/0065's own Settings surface: backup
// location + last-backup time (live-synced), "Back up now", export/
// import everything, reveal-folder, and the synced-folder warning.

function fileToBase64(file: File): Promise<string> {
  return file.arrayBuffer().then((buf) => {
    const bytes = new Uint8Array(buf)
    let binary = ''
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
    return btoa(binary)
  })
}

function summaryLine(t: (key: string, opts?: Record<string, unknown>) => string, s: ImportEverythingSummary) {
  return (s.families ?? [])
    .map((f) => t('settings.dataStewardship.familyCount', { name: f.name, created: f.created, updated: f.updated }))
    .join(', ')
}

function DataStewardshipSection() {
  const { t } = useTranslation('views')
  const [status, setStatus] = useState<BackupStatus | null>(null)
  const [backingUp, setBackingUp] = useState(false)
  const [error, setError] = useState('')
  // Which action produced `error` -- the copyable diagnosis's own
  // context (goal 0127 slice 4): this section shares one error slot
  // across several distinct operations, so the operation itself has to
  // travel alongside the message.
  const [errorOp, setErrorOp] = useState('')
  const [exporting, setExporting] = useState(false)
  const [pendingArchive, setPendingArchive] = useState<{ data: string; summary: ImportEverythingSummary } | null>(null)
  const [importResult, setImportResult] = useState<ImportEverythingSummary | null>(null)
  const importInputRef = useRef<HTMLInputElement>(null)

  const fail = (op: string, err: unknown) => {
    setError(String(err))
    setErrorOp(op)
  }

  const refresh = () => {
    BackupService.GetBackupStatus().then(setStatus).catch((err) => fail('Refresh status', err))
  }

  useEffect(() => {
    refresh()
    return Events.On('mill-data-changed', (evt) => {
      const entity = (evt.data as { entity?: string })?.entity
      if (entity === 'backup') refresh()
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only subscription, same pattern WorkflowRunsPanel.tsx's identical effect documents
  }, [])

  const backupNow = () => {
    setError('')
    setBackingUp(true)
    BackupService.BackupNow(0)
      .then(setStatus)
      .catch((err) => fail('Back up now', err))
      .finally(() => setBackingUp(false))
  }

  const revealFolder = () => {
    BackupService.RevealBackupFolder().catch((err) => fail('Reveal backup folder', err))
  }

  const exportEverything = () => {
    setError('')
    setExporting(true)
    BackupService.ExportEverything()
      .then((data) => downloadBlob(`mill-backup-${new Date().toISOString().slice(0, 10)}.zip`, base64ToBlob(data, 'application/zip')))
      .catch((err) => fail('Export everything', err))
      .finally(() => setExporting(false))
  }

  const openImportPicker = () => {
    setError('')
    importInputRef.current?.click()
  }

  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    fileToBase64(file)
      .then((data) => BackupService.PreviewImportEverything(data).then((summary) => setPendingArchive({ data, summary })))
      .catch((err) => fail('Import everything', err))
  }

  const confirmImport = () => {
    if (!pendingArchive) return
    const { data } = pendingArchive
    setPendingArchive(null)
    BackupService.ImportEverything(data)
      .then(setImportResult)
      .catch((err) => fail('Import everything', err))
  }

  return (
    <>
      <Text as="p" size="small" className={styles.muted}>
        {t('settings.dataStewardship.description')}
      </Text>

      {status && !status.available && (
        <Text as="p" size="small" className={styles.muted}>
          {t('settings.dataStewardship.unavailable')}
        </Text>
      )}

      <FormControl>
        <FormControl.Label>{t('settings.dataStewardship.locationLabel')}</FormControl.Label>
        <Stack direction="horizontal" gap="condensed" align="center">
          <Text size="small" className={styles.muted} data-testid="backup-location">{status?.dir ?? ''}</Text>
          <Button size="small" variant="invisible" leadingVisual={FileDirectoryIcon} onClick={revealFolder}>
            {t('settings.dataStewardship.revealFolder')}
          </Button>
        </Stack>
        <FormControl.Caption>
          {status?.hasBackup
            ? t('settings.dataStewardship.lastBackup', { time: new Date(status.lastBackupAt).toLocaleString() })
            : t('settings.dataStewardship.noBackupYet')}
        </FormControl.Caption>
      </FormControl>

      <Stack direction="horizontal" gap="condensed" align="center" style={{ marginTop: 'var(--base-size-8)' }}>
        <Button size="small" onClick={backupNow} disabled={backingUp || status?.available === false} data-testid="backup-now">
          {backingUp ? t('settings.dataStewardship.backingUp') : t('settings.dataStewardship.backupNow')}
        </Button>
        <Button size="small" variant="invisible" leadingVisual={DownloadIcon} onClick={exportEverything} disabled={exporting} data-testid="export-everything">
          {t('settings.dataStewardship.exportEverything')}
        </Button>
        <input
          ref={importInputRef}
          type="file"
          accept="application/zip,.zip"
          data-testid="import-everything-input"
          style={{ display: 'none' }}
          onChange={handleImportFile}
        />
        <Button size="small" variant="invisible" leadingVisual={UploadIcon} onClick={openImportPicker} data-testid="import-everything">
          {t('settings.dataStewardship.importEverything')}
        </Button>
      </Stack>

      <Text as="p" size="small" className={styles.muted} style={{ marginTop: 'var(--base-size-8)' }}>
        {t('settings.dataStewardship.syncedFolderWarning')}
      </Text>
      <Text as="p" size="small" className={styles.muted} data-testid="export-mirror-note">
        {t('settings.dataStewardship.mirrorFilesNote')}
      </Text>

      {error && (
        <Stack direction="horizontal" gap="condensed" align="center">
          <Text as="p" size="small" className={styles.error}>{error}</Text>
          <CopyDiagnosisButton
            error={error}
            context={{ Operation: errorOp, 'Last backup': status?.hasBackup ? status.lastBackupAt : undefined }}
            testId="data-stewardship-copy-diagnosis"
          />
        </Stack>
      )}
      {importResult && (
        <Text as="p" size="small" className={styles.result} data-testid="import-everything-result">
          {summaryLine(t, importResult)}
        </Text>
      )}

      {pendingArchive && (
        <ConfirmDialog
          title={t('settings.dataStewardship.importConfirmTitle')}
          body={summaryLine(t, pendingArchive.summary) || t('settings.dataStewardship.importConfirmEmpty')}
          confirmLabel={t('settings.dataStewardship.importConfirmButton')}
          onCancel={() => setPendingArchive(null)}
          onConfirm={confirmImport}
        />
      )}
    </>
  )
}

export default DataStewardshipSection
