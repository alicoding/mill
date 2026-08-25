import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Stack, Text } from '@primer/react'
import { AtlasService } from '../shared/bindings'
import runbookStyles from '../shared/ListCard.module.css'
import { isDiagramMirrorExtension } from './atlasDiagramMirror'

// The honest "file's gone" state every diagram/mermaid mirror host
// renders instead of a stale or blank view (goal 0194's live
// round-trip slice): the source file could not be found on disk, with
// a real re-pick action offered rather than just a dead-end message.
// Shared by the drawio/mermaid card-page units and the board-object
// diagram face, which differ only in which RPC re-points the mirror
// (onRepick).
export function AtlasMirrorMissingState({ testIdPrefix, onRepick }: {
  testIdPrefix: string
  onRepick: (path: string) => Promise<unknown>
}) {
  const { t } = useTranslation('atlas')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<'' | 'invalid' | 'failed'>('')

  const chooseFile = () => {
    setError('')
    AtlasService.PickDiagramFile()
      .then((path) => {
        if (!path) return undefined // cancelled -- state stays as-is
        // The native dialog's own extension filter is display-only on
        // some platforms, so a picked file is still re-checked here
        // (windowing.PickDiagramFile's own doc comment carries the same
        // constraint PickImageFile's does).
        if (!isDiagramMirrorExtension(path)) {
          setError('invalid')
          return undefined
        }
        setBusy(true)
        return onRepick(path)
          .catch(() => setError('failed'))
          .finally(() => setBusy(false))
      })
      .catch(() => setError('failed'))
  }

  return (
    <Stack direction="vertical" gap="condensed" data-testid={`${testIdPrefix}-missing`}>
      <Text as="p" size="small" className={runbookStyles.error}>{t('overlay.mirrorMissing')}</Text>
      <Button size="small" disabled={busy} onClick={chooseFile} data-testid={`${testIdPrefix}-choose-file`}>
        {t('overlay.chooseFileAgain')}
      </Button>
      {error && (
        <Text as="p" size="small" className={runbookStyles.error} data-testid={`${testIdPrefix}-choose-file-error`}>
          {error === 'invalid' ? t('overlay.chooseFileInvalid') : t('overlay.chooseFileFailed')}
        </Text>
      )}
    </Stack>
  )
}
