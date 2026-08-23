import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Text, TextInput } from '@primer/react'
import { readClipboardImageFile } from '../shared/clipboardRead'
import { IMAGE_EXTENSIONS } from './atlasUnitMirror'
import { extensionOf } from './unitRegistry'
import styles from './AtlasImageInput.module.css'

// The image tool's own popover content (goal 0169 slice 2's
// paste-or-drop proof): a path/URL field that works identically over
// plain http (frontend.md's secure-context rule -- this never touches
// navigator.clipboard), plus a real paste gesture into the same field
// that lands a clipboard image directly. Rendering the created card is
// the existing mirror-image unit's job (ADR-0043); this component only
// resolves WHICH path or file to hand off.
export function AtlasImageInput({ onSubmitPath, onSubmitFile, onDone }: {
  onSubmitPath: (path: string) => Promise<void>
  onSubmitFile: (file: File) => Promise<void>
  onDone: () => void
}) {
  const { t } = useTranslation('atlas')
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submitPath = () => {
    const trimmed = value.trim()
    if (!trimmed) {
      setError(t('imageInput.empty'))
      return
    }
    if (!IMAGE_EXTENSIONS.has(extensionOf(trimmed))) {
      setError(t('imageInput.invalidExtension'))
      return
    }
    setBusy(true)
    setError(null)
    onSubmitPath(trimmed)
      .then(onDone)
      .catch(() => {
        setBusy(false)
        setError(t('imageInput.addFailed'))
      })
  }

  const submitFile = (file: File) => {
    setBusy(true)
    setError(null)
    onSubmitFile(file)
      .then(onDone)
      .catch(() => {
        setBusy(false)
        setError(t('imageInput.addFailed'))
      })
  }

  return (
    <div className={styles.input} data-testid="atlas-image-input">
      <TextInput
        data-testid="atlas-image-path"
        placeholder={t('imageInput.pathPlaceholder')}
        aria-label={t('imageInput.pathLabel')}
        value={value}
        disabled={busy}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submitPath()
        }}
        onPaste={(e) => {
          const file = readClipboardImageFile(e.clipboardData)
          if (!file) return
          e.preventDefault()
          submitFile(file)
        }}
      />
      <Text size="small" className={styles.hint} data-testid="atlas-image-paste-hint">
        {t('imageInput.pasteHint')}
      </Text>
      {error && <Text size="small" className={styles.error} data-testid="atlas-image-error">{error}</Text>}
      <Button size="small" variant="primary" block disabled={busy} onClick={submitPath} data-testid="atlas-image-add">
        {t('imageInput.add')}
      </Button>
    </div>
  )
}
