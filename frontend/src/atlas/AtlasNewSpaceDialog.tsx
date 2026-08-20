import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Dialog, FormControl, TextInput } from '@primer/react'
import type { Kind } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { KindPicker } from './KindPicker'

// "New space" (goal 0139): the one structural create that can't be a
// placement -- a second ROOT card has no canvas to point at until it
// exists. Reached from the board's right-click at a root-level view;
// naming a space up front is the convention, not form-thinking.
export function AtlasNewSpaceDialog({ kinds, onCreate, onClose }: {
  kinds: Kind[]
  onCreate: (kindID: string, title: string) => Promise<void>
  onClose: () => void
}) {
  const { t } = useTranslation('atlas')
  const [kindID, setKindID] = useState(kinds[0]?.ID ?? '')
  const [title, setTitle] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const submit = async () => {
    setSaving(true)
    setError('')
    try {
      await onCreate(kindID, title)
      onClose()
    } catch (err) {
      setError(String(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog
      title={t('newSpace.title')}
      onClose={onClose}
      footerButtons={[
        { content: t('cancel'), onClick: onClose },
        { content: t('create.createButton'), buttonType: 'primary', onClick: () => void submit(), disabled: saving || !title.trim() || !kindID },
      ]}
    >
      <FormControl>
        <FormControl.Label>{t('create.kindLabel')}</FormControl.Label>
        <KindPicker kinds={kinds} value={kindID} onChange={setKindID} ariaLabel={t('create.kindLabel')} testId="atlas-create-kind" />
      </FormControl>
      <FormControl>
        <FormControl.Label>{t('create.titleLabel')}</FormControl.Label>
        <TextInput value={title} data-testid="atlas-create-title" onChange={(e) => setTitle(e.target.value)} block />
      </FormControl>
      {error && <FormControl.Caption>{error}</FormControl.Caption>}
    </Dialog>
  )
}
