import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Text } from '@primer/react'
import { AtlasService } from '../shared/bindings'
import { readClipboardImageFile } from '../shared/clipboardRead'
import { imagePathFromClipboardText } from './atlasCreateHelpers'
import { IMAGE_EXTENSIONS } from './atlasUnitMirror'
import { extensionOf } from './unitRegistry'
import styles from './AtlasImageInput.module.css'

// The image tool's own popover content (goal 0169 slice 2's
// paste-or-drop proof, re-pointed by goal 0206's own affordance fix): a
// native OS file picker plus a real paste gesture, never a typed path
// field -- a filesystem path is developer vocabulary, not something a
// user is asked to type (ux-writing.md). Rendering the created object
// is the placement door's job (useAtlasImageCreate.ts); this component
// only resolves WHICH path or file to hand off.
export function AtlasImageInput({ onSubmitPath, onSubmitFile, onSubmitText, onDone }: {
  onSubmitPath: (path: string) => Promise<void>
  onSubmitFile: (file: File) => Promise<void>
  onSubmitText: (text: string) => Promise<void>
  onDone: () => void
}) {
  const { t } = useTranslation('atlas')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submitPath = (path: string) => {
    setBusy(true)
    setError(null)
    onSubmitPath(path)
      .then(onDone)
      .catch(() => {
        setBusy(false)
        setError(t('imageInput.addFailed'))
      })
  }

  const pickFile = () => {
    setError(null)
    AtlasService.PickImageFile()
      .then((path) => {
        if (!path) return // cancelled -- popover stays open, nothing submitted
        // The native dialog's own extension filter is display-only on
        // some platforms, so a picked file is still re-checked here
        // (windowing.PickImageFile's own doc comment carries the same
        // constraint).
        if (!IMAGE_EXTENSIONS.has(extensionOf(path))) {
          setError(t('imageInput.invalidExtension'))
          return
        }
        submitPath(path)
      })
      .catch(() => setError(t('imageInput.addFailed')))
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
      <Button size="small" variant="primary" block disabled={busy} onClick={pickFile} data-testid="atlas-image-pick">
        {t('imageInput.pick')}
      </Button>
      <div
        className={styles.pasteZone}
        data-testid="atlas-image-paste-zone"
        tabIndex={0}
        autoFocus
        onPaste={(e) => {
          // preventDefault on every handled shape below also tells the
          // board's own window-level paste door (useAtlasPaste.ts) to
          // stand down -- without it, both doors land the same paste
          // and the object appears twice.
          const file = readClipboardImageFile(e.clipboardData)
          if (file) {
            e.preventDefault()
            submitFile(file)
            return
          }
          // No bitmap on the clipboard: a pasted image-file PATH or
          // image URL (text) lands through the same server-side
          // recognizer the board's own paste door uses. Text that
          // isn't image-shaped gets the same inline answer the
          // picker's own extension re-check gives, never silence.
          const path = imagePathFromClipboardText(
            e.clipboardData.getData('text/uri-list'),
            e.clipboardData.getData('text/plain'),
          )
          if (path) {
            e.preventDefault()
            setBusy(true)
            setError(null)
            onSubmitText(path)
              .then(onDone)
              .catch(() => {
                setBusy(false)
                setError(t('imageInput.addFailed'))
              })
            return
          }
          if (e.clipboardData.getData('text/plain').trim() !== '') {
            e.preventDefault()
            setError(t('imageInput.invalidExtension'))
          }
        }}
      >
        <Text size="small" className={styles.hint} data-testid="atlas-image-paste-hint">
          {t('imageInput.pasteHint')}
        </Text>
      </div>
      {error && <Text size="small" className={styles.error} data-testid="atlas-image-error">{error}</Text>}
    </div>
  )
}
