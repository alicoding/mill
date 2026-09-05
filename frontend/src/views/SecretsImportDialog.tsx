import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Checkbox, Dialog, FormControl, Stack, Text, TextInput } from '@primer/react'
import { SecretService } from '../shared/bindings'
import { useBuildInfoStore } from '../shared/buildInfoStore'
import { messageFor } from '../shared/userError'
import styles from './SecretsView.module.css'

// Importing from an export the reader made themselves (goal 0306 S4).
// Mill never reads another application's credential database; it reads
// the file the reader exported, and offers to delete it right after,
// because an export holds every password in plain text.

export function SecretsImportDialog({ onClose, onImported }: {
  onClose: () => void
  onImported: (count: number) => void
}) {
  const { t } = useTranslation('secrets')
  const [path, setPath] = useState('')
  const [count, setCount] = useState<number | null>(null)
  const [fileName, setFileName] = useState('')
  const [deleteAfter, setDeleteAfter] = useState(true)
  // The machine's own picker exists only in the desktop app; in
  // server mode the reader types the path instead.
  const isDesktop = useBuildInfoStore((s) => s.isDesktop)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const choose = () => {
    setError('')
    SecretService.ChooseExportFile()
      .then((chosen) => { if (chosen) { setPath(chosen); void preview(chosen) } })
      .catch((err) => setError(messageFor(err, t)))
  }

  const preview = async (target: string) => {
    setBusy(true)
    setError('')
    setCount(null)
    try {
      const result = await SecretService.PreviewExport(target)
      setCount(result.Count)
      setFileName(result.FileName)
    } catch (err) {
      setError(messageFor(err, t))
    } finally {
      setBusy(false)
    }
  }

  const runImport = async () => {
    setBusy(true)
    setError('')
    try {
      const imported = await SecretService.ImportExport(path, deleteAfter)
      onImported(imported)
    } catch (err) {
      setError(messageFor(err, t))
      setBusy(false)
    }
  }

  return (
    <Dialog
      title={t('import.title')}
      onClose={onClose}
      footerButtons={[
        { content: t('cancel'), onClick: onClose },
        { content: t('import.confirm'), buttonType: 'primary', onClick: () => void runImport(), disabled: busy || count === null || count === 0 },
      ]}
    >
      <Stack direction="vertical" gap="condensed">
        <FormControl>
          <FormControl.Label>{t('import.fileLabel')}</FormControl.Label>
          <Stack direction="horizontal" gap="condensed" align="center">
            <TextInput
              value={path}
              onChange={(e) => setPath(e.target.value)}
              onBlur={() => { if (path.trim() !== '') void preview(path.trim()) }}
              block
              placeholder={t('import.filePlaceholder')}
              data-testid="secret-import-path"
            />
            {isDesktop && <Button onClick={choose} data-testid="secret-import-choose">{t('import.choose')}</Button>}
          </Stack>
          <FormControl.Caption>{t('import.fileCaption')}</FormControl.Caption>
        </FormControl>
        {count !== null && (
          <Text as="p" size="small" data-testid="secret-import-preview">
            {t('import.found', { count, file: fileName })}
          </Text>
        )}
        <FormControl>
          <Checkbox checked={deleteAfter} onChange={(e) => setDeleteAfter(e.target.checked)} data-testid="secret-import-delete" />
          <FormControl.Label>{t('import.deleteLabel')}</FormControl.Label>
          <FormControl.Caption>{t('import.deleteCaption')}</FormControl.Caption>
        </FormControl>
        {error && <Text as="p" size="small" className={styles.error} data-testid="secret-import-error">{error}</Text>}
      </Stack>
    </Dialog>
  )
}
