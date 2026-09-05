import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Checkbox, Dialog, FormControl, Stack, Text, TextInput } from '@primer/react'
import { DataTable } from '@primer/react/experimental'
import { SecretService } from './bindings'
import { useBuildInfoStore } from './buildInfoStore'
import type { DotenvFound } from '../../bindings/github.com/alicoding/mill/internal/services/secretsvc/models'
import { messageFor } from './userError'
import styles from './ListCard.module.css'

// Finding .env files under a folder the reader chose (goal 0306 S4).
// Nothing scans without a folder and nothing defaults to the home
// directory: the reader says where, Mill lists what is there, and the
// reader picks what becomes a source or an entry.

export function SecretsDotenvScanDialog({ onClose, onChanged }: {
  onClose: () => void
  onChanged: () => void
}) {
  const { t } = useTranslation('secrets')
  const [folder, setFolder] = useState('')
  const [found, setFound] = useState<DotenvFound[] | null>(null)
  const [chosen, setChosen] = useState<string[]>([])
  // The machine's own picker exists only in the desktop app; in
  // server mode the reader types the path instead.
  const isDesktop = useBuildInfoStore((s) => s.isDesktop)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const choose = () => {
    setError('')
    SecretService.ChooseScanFolder()
      .then((picked) => { if (picked) setFolder(picked) })
      .catch((err) => setError(messageFor(err, t)))
  }

  const scan = async () => {
    setBusy(true)
    setError('')
    try {
      const results = await SecretService.FindDotenvFiles(folder)
      setFound(results ?? [])
      setChosen((results ?? []).map((f) => f.Path))
    } catch (err) {
      setError(messageFor(err, t))
      setFound(null)
    } finally {
      setBusy(false)
    }
  }

  const act = async (run: () => Promise<number>) => {
    setBusy(true)
    setError('')
    try {
      await run()
      onChanged()
    } catch (err) {
      setError(messageFor(err, t))
    } finally {
      setBusy(false)
    }
  }

  const toggle = (path: string) => {
    setChosen(chosen.includes(path) ? chosen.filter((p) => p !== path) : [...chosen, path])
  }

  return (
    <Dialog
      title={t('scan.title')}
      onClose={onClose}
      width="large"
      footerButtons={[
        { content: t('cancel'), onClick: onClose },
        { content: t('scan.importKeys'), onClick: () => void act(() => SecretService.ImportDotenvKeys(folder, chosen)), disabled: busy || chosen.length === 0 },
        { content: t('scan.addAsSources'), buttonType: 'primary', onClick: () => void act(() => SecretService.AddDotenvSources(folder, chosen)), disabled: busy || chosen.length === 0 },
      ]}
    >
      <Stack direction="vertical" gap="condensed">
        <FormControl>
          <FormControl.Label>{t('scan.folderLabel')}</FormControl.Label>
          <Stack direction="horizontal" gap="condensed" align="center">
            <TextInput value={folder} onChange={(e) => setFolder(e.target.value)} block placeholder={t('scan.folderPlaceholder')} data-testid="secret-scan-folder" />
            {isDesktop && <Button onClick={choose} data-testid="secret-scan-choose">{t('scan.choose')}</Button>}
            <Button variant="primary" onClick={() => void scan()} disabled={busy || folder.trim() === ''} data-testid="secret-scan-run">{t('scan.run')}</Button>
          </Stack>
          <FormControl.Caption>{t('scan.folderCaption')}</FormControl.Caption>
        </FormControl>
        {found !== null && found.length === 0 && (
          <Text as="p" size="small" data-testid="secret-scan-empty">{t('scan.empty')}</Text>
        )}
        {found !== null && found.length > 0 && (
          <DataTable
            aria-label={t('scan.tableLabel')}
            data={found.map((f) => ({ ...f, id: f.Path }))}
            columns={[
              {
                header: '', id: 'chosen', width: 'auto',
                renderCell: (f) => (
                  <Checkbox
                    checked={chosen.includes(f.Path)}
                    onChange={() => toggle(f.Path)}
                    aria-label={t('scan.chooseFile', { file: f.RelPath })}
                    data-testid={`secret-scan-pick-${f.RelPath}`}
                  />
                ),
              },
              { header: t('scan.columns.file'), field: 'RelPath', rowHeader: true },
              { header: t('scan.columns.keys'), id: 'keys', renderCell: (f) => String(f.Keys) },
            ]}
          />
        )}
        {error && <Text as="p" size="small" className={styles.error} data-testid="secret-scan-error">{error}</Text>}
      </Stack>
    </Dialog>
  )
}
