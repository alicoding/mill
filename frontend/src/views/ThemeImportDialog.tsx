import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Dialog, FormControl, Select, Stack, Text, TextInput } from '@primer/react'
import { PluginService } from '../../bindings/github.com/alicoding/mill/internal/services/pluginsvc'
import type { ThemeImportPreview } from '../../bindings/github.com/alicoding/mill/internal/services/pluginsvc/models'
import { AdvancedDisclosure } from '../shared/AdvancedDisclosure'
import { pushNotice } from '../shared/noticeStore'
import { messageFor } from '../shared/userError'
import listStyles from '../shared/ListCard.module.css'
import { bytesToBase64 } from './themeImportFile'

const MAX_THEME_BYTES = 2 * 1024 * 1024

export function ThemeImportDialog({ onClose, onImported }: {
  onClose: () => void
  onImported: (pluginID: string) => void
}) {
  const { t } = useTranslation('views')
  const inputRef = useRef<HTMLInputElement>(null)
  const request = useRef(0)
  const [preview, setPreview] = useState<ThemeImportPreview | null>(null)
  const [encoded, setEncoded] = useState('')
  const [basename, setBasename] = useState('')
  const [name, setName] = useState('')
  const [family, setFamily] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const chooseFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    const sequence = ++request.current
    setPreview(null)
    setEncoded('')
    setBasename('')
    setName('')
    setFamily('')
    setError('')
    if (file.size > MAX_THEME_BYTES) {
      setError(t('extensions.themeImport.tooLarge'))
      return
    }
    try {
      const nextEncoded = bytesToBase64(new Uint8Array(await file.arrayBuffer()))
      const next = await PluginService.PreviewThemeImport(nextEncoded, file.name)
      if (request.current !== sequence) return
      setEncoded(nextEncoded)
      setBasename(file.name)
      setPreview(next)
      setName(next.SuggestedName)
      setFamily(next.Family)
    } catch (err) {
      if (request.current === sequence) setError(messageFor(err, t))
    }
  }

  const install = async () => {
    if (!preview) return
    setBusy(true)
    setError('')
    try {
      const result = await PluginService.ImportTheme(encoded, basename, name, family)
      pushNotice({
        level: 'success',
        text: result.NeedsAllow ? t('extensions.themeImport.doneNeedsAllow') : t('extensions.themeImport.done'),
      })
      onImported(result.PluginID)
    } catch (err) {
      setError(messageFor(err, t))
    } finally {
      setBusy(false)
    }
  }

  const close = () => {
    if (!busy) onClose()
  }
  const valid = preview !== null && name.trim() !== '' && [...name.trim()].length <= 120 && (family === 'light' || family === 'dark')

  return (
    <Dialog
      title={t('extensions.themeImport.title')}
      onClose={close}
      width="large"
      footerButtons={[
        { content: t('extensions.themeImport.cancel'), onClick: close, autoFocus: true, disabled: busy },
        { content: t('extensions.themeImport.import'), buttonType: 'primary', onClick: () => void install(), disabled: busy || !valid },
      ]}
    >
      <Stack direction="vertical" gap="condensed" data-testid="theme-import-dialog">
        <Text as="p" size="small" className={listStyles.muted}>{t('extensions.themeImport.caption')}</Text>
        <input
          ref={inputRef}
          type="file"
          accept=".json,.jsonc,application/json"
          style={{ display: 'none' }}
          data-testid="theme-import-file"
          onChange={(event) => void chooseFile(event)}
        />
        <Button onClick={() => inputRef.current?.click()} disabled={busy} data-testid="theme-import-choose">
          {t('extensions.themeImport.choose')}
        </Button>
        {preview && (
          <>
            <FormControl required>
              <FormControl.Label>{t('extensions.themeImport.name')}</FormControl.Label>
              <TextInput value={name} maxLength={120} block onChange={(event) => setName(event.target.value)} data-testid="theme-import-name" />
            </FormControl>
            <FormControl required>
              <FormControl.Label>{t('extensions.themeImport.appearance')}</FormControl.Label>
              <Select value={family} onChange={(event) => setFamily(event.target.value)} data-testid="theme-import-family">
                <Select.Option value="">{t('extensions.themeImport.chooseAppearance')}</Select.Option>
                <Select.Option value="light">{t('extensions.themeImport.light')}</Select.Option>
                <Select.Option value="dark">{t('extensions.themeImport.dark')}</Select.Option>
              </Select>
            </FormControl>
            <Text as="p" size="small" weight="semibold" data-testid="theme-import-code-state">
              {t('extensions.themeImport.dataOnly')}
            </Text>
            <Text as="p" size="small" data-testid="theme-import-summary">
              {t('extensions.themeImport.summary', { mapped: preview.Mapped, total: preview.Total })}
            </Text>
            <Text as="p" size="small" className={listStyles.muted}>{t('extensions.themeImport.limitations')}</Text>
            <AdvancedDisclosure open={false} testId="theme-import-compatibility" summary={t('extensions.themeImport.compatibility')}>
              <CompatibilityList label={t('extensions.themeImport.used')} keys={preview.MappedKeys ?? []} />
              <CompatibilityList label={t('extensions.themeImport.unmapped')} keys={preview.UnmappedKeys ?? []} />
              {(preview.InvalidKeys?.length ?? 0) > 0 && (
                <CompatibilityList label={t('extensions.themeImport.invalid')} keys={preview.InvalidKeys ?? []} />
              )}
            </AdvancedDisclosure>
          </>
        )}
        {error && <Text as="p" size="small" className={listStyles.error} data-testid="theme-import-error">{error}</Text>}
      </Stack>
    </Dialog>
  )
}

function CompatibilityList({ label, keys }: { label: string; keys: string[] }) {
  const { t } = useTranslation('views')
  return (
    <Stack direction="vertical" gap="none">
      <Text size="small" weight="semibold">{label}</Text>
      <Text as="p" size="small" className={listStyles.muted}>
        {keys.length > 0 ? keys.join(', ') : t('extensions.themeImport.none')}
      </Text>
    </Stack>
  )
}
