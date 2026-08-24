import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Dialog, FormControl } from '@primer/react'
import { EntityRefField } from '../configure/EntityRefField'

// "Table from a List" (goal 0105; the one dialog surviving goal
// 0139's menu retirement -- reached from the tray's size-picker
// footer): pick the List to project; the table lands inside the
// current space (a projection is content of the board being viewed) as
// a board-local "table" object (goal 0179 S2) -- no Kind, no title
// question, matching every other board object. Promote to card is
// where a Kind and a title first apply.
export function AtlasTableFromListDialog({ onCreate, onClose }: {
  onCreate: (listID: string) => Promise<void>
  onClose: () => void
}) {
  const { t } = useTranslation('atlas')
  const [listID, setListID] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const submit = async () => {
    setSaving(true)
    setError('')
    try {
      await onCreate(listID)
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
        { content: t('create.createButton'), buttonType: 'primary', onClick: () => void submit(), disabled: saving || !listID },
      ]}
    >
      <FormControl>
        <FormControl.Label>{t('create.listLabel')}</FormControl.Label>
        <EntityRefField refKind="list" value={listID} onChange={setListID} />
        <FormControl.Caption>{t('create.listCaption')}</FormControl.Caption>
      </FormControl>
      {error && <FormControl.Caption>{error}</FormControl.Caption>}
    </Dialog>
  )
}
