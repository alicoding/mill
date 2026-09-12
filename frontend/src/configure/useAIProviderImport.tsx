import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Dialog, Stack, Text } from '@primer/react'
import { ConfigureService } from '../shared/bindings'
import type { ImportPreview } from '../../bindings/github.com/alicoding/mill/internal/domain/aiprovider/models'
import { ImportMode } from '../../bindings/github.com/alicoding/mill/internal/domain/aiprovider/models'
import styles from '../shared/ListCard.module.css'
import { messageFor } from '../shared/userError'

export function useAIProviderImport(onImported: () => void) {
  const { t } = useTranslation('configure')
  const importInputRef = useRef<HTMLInputElement>(null)
  const generation = useRef(0)
  const [pending, setPending] = useState<{ text: string; preview: ImportPreview } | null>(null)
  const [importError, setImportError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => () => { generation.current++ }, [])

  const openImportPicker = () => { setImportError(null); importInputRef.current?.click() }
  const cancel = () => { generation.current++; setPending(null); setBusy(false) }
  const requestPreview = async (text: string) => {
    const request = ++generation.current
    setBusy(true)
    setImportError(null)
    try {
      const preview = await ConfigureService.PreviewAIProviderImport(text)
      if (request !== generation.current) return
      if (preview.mode === ImportMode.ImportModeCreate) {
        await ConfigureService.ApplyAIProviderImport(text, preview.expectedRevision)
        if (request !== generation.current) return
        onImported()
      } else {
        setPending({ text, preview })
      }
    } catch (err) {
      if (request === generation.current) setImportError(messageFor(err, t))
    } finally {
      if (request === generation.current) setBusy(false)
    }
  }
  const handleImportFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    const request = ++generation.current
    setPending(null)
    setBusy(true)
    file.text().then((text) => {
      if (request !== generation.current) return
      return requestPreview(text)
    }).catch((err) => {
      if (request !== generation.current) return
      setImportError(messageFor(err, t))
      setBusy(false)
    })
  }
  const apply = async () => {
    if (!pending || busy) return
    const shown = pending
    const request = ++generation.current
    setBusy(true)
    setImportError(null)
    try {
      await ConfigureService.ApplyAIProviderImport(shown.text, shown.preview.expectedRevision)
      if (request !== generation.current) return
      setPending(null)
      onImported()
    } catch (err) {
      if (request !== generation.current) return
      setImportError(messageFor(err, t))
      try {
        const preview = await ConfigureService.PreviewAIProviderImport(shown.text)
        if (request === generation.current) setPending({ text: shown.text, preview })
      } catch {
        if (request === generation.current) setPending(null)
      }
    } finally {
      if (request === generation.current) setBusy(false)
    }
  }

  const dialog = pending && (
    <Dialog title={t('configureAIProviders.import.title', { label: pending.preview.current?.label ?? pending.preview.proposed.label })} onClose={cancel} footerButtons={[
      { content: t('entityRefField.cancel'), onClick: cancel },
      { content: t('configureAIProviders.import.replace'), buttonType: 'primary', disabled: busy, onClick: () => void apply() },
    ]}>
      <Stack direction="vertical" gap="normal">
        {([pending.preview.current && { title: t('configureAIProviders.import.current'), value: pending.preview.current }, { title: t('configureAIProviders.import.imported'), value: pending.preview.proposed }].filter(Boolean) as { title: string; value: typeof pending.preview.proposed }[]).map(({ title, value }) => (
          <Stack key={title} direction="vertical" gap="condensed">
            <Text weight="semibold">{title}</Text>
            <Text size="small">{value.label}</Text>
            <Text size="small">{value.kind} · {value.model}</Text>
            <Text size="small" className={styles.muted}>{value.endpoint}</Text>
            <Text size="small" className={styles.muted}>{value.keyRef ? t('configureAIProviders.import.secretUnverified', { reference: value.keyRef }) : t('configureAIProviders.import.noSecretReference')}</Text>
          </Stack>
        ))}
        <Text size="small" weight="semibold">{t('configureAIProviders.import.usedBy')}</Text>
        {(pending.preview.references?.Workflows ?? []).map((workflow) => <Text size="small" key={"workflow-" + workflow}>{t('configureAIProviders.import.workflowConsumer', { workflow })}</Text>)}
        {(pending.preview.references?.Boards ?? []).map((board) => <Text size="small" key={"board-" + board.BoardID + "-" + board.ObjectID}>{t('configureAIProviders.import.boardConsumer', { label: board.Label, board: board.BoardID })}</Text>)}
        {(pending.preview.references?.Plugins ?? []).map((plugin) => <Text size="small" key={"plugin-" + plugin.PluginID + "-" + plugin.SettingKey}>{t('configureAIProviders.import.pluginConsumer', { label: plugin.Label, setting: plugin.SettingKey })}</Text>)}
        {(pending.preview.references?.Workflows?.length ?? 0) + (pending.preview.references?.Boards?.length ?? 0) + (pending.preview.references?.Plugins?.length ?? 0) === 0 && <Text size="small" className={styles.muted}>{t('configureAIProviders.import.noConsumers')}</Text>}
      </Stack>
    </Dialog>
  )

  return { importInputRef, importError, setImportError, busy, openImportPicker, handleImportFile, dialog }
}
