import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Dialog, FormControl, TextInput } from '@primer/react'
import type { Kind } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { ConfigureService } from '../shared/bindings'
import { EntityRefField } from '../configure/EntityRefField'
import { KindPicker } from './KindPicker'

// "Table from a List" (goal 0105; the one dialog surviving goal
// 0139's menu retirement -- reached from the tray's size-picker
// footer): pick the List to project, a Kind, and a title; the card
// lands inside the current space (a projection is content of the
// board being viewed).
export function AtlasTableFromListDialog({ kinds, onCreate, onClose }: {
  kinds: Kind[]
  onCreate: (kindID: string, title: string, listID: string) => Promise<void>
  onClose: () => void
}) {
  const { t } = useTranslation('atlas')
  const [kindID, setKindID] = useState(kinds[0]?.ID ?? '')
  const [title, setTitle] = useState('')
  const [listID, setListID] = useState('')
  const [titleTouched, setTitleTouched] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Picking a List prefills an untouched title with the List's label --
  // the natural default name for its table.
  const pickList = (id: string) => {
    setListID(id)
    if (titleTouched || !id) return
    void ConfigureService.Lists().then((lists) => {
      const label = (lists ?? []).find((l) => l.ID === id)?.Label
      if (label) setTitle(label)
    }).catch(() => {})
  }

  const submit = async () => {
    setSaving(true)
    setError('')
    try {
      await onCreate(kindID, title, listID)
      onClose()
    } catch (err) {
      setError(String(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog
      title={t('create.addTable')}
      onClose={onClose}
      footerButtons={[
        { content: t('cancel'), onClick: onClose },
        { content: t('create.createButton'), buttonType: 'primary', onClick: () => void submit(), disabled: saving || !title.trim() || !kindID || !listID },
      ]}
    >
      <FormControl>
        <FormControl.Label>{t('create.listLabel')}</FormControl.Label>
        <EntityRefField refKind="list" value={listID} onChange={pickList} />
        <FormControl.Caption>{t('create.listCaption')}</FormControl.Caption>
      </FormControl>
      <FormControl>
        <FormControl.Label>{t('create.kindLabel')}</FormControl.Label>
        <KindPicker kinds={kinds} value={kindID} onChange={setKindID} ariaLabel={t('create.kindLabel')} testId="atlas-create-kind" />
      </FormControl>
      <FormControl>
        <FormControl.Label>{t('create.titleLabel')}</FormControl.Label>
        <TextInput value={title} data-testid="atlas-create-title" onChange={(e) => { setTitle(e.target.value); setTitleTouched(true) }} block />
      </FormControl>
      {error && <FormControl.Caption>{error}</FormControl.Caption>}
    </Dialog>
  )
}
