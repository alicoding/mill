import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ActionList, ActionMenu, Dialog, FormControl, TextInput } from '@primer/react'
import { PlusIcon } from '@primer/octicons-react'
import type { Kind } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { ConfigureService } from '../shared/bindings'
import { EntityRefField } from '../configure/EntityRefField'
import { KindPicker } from './KindPicker'

type Containment = 'sibling' | 'child'
type PendingForm = Containment | 'table' | 'table-new'

// The "+" affordance (docs/goals/0061): asks sibling-vs-child EXPLICITLY
// before asking for a Kind/title, so containment is always a deliberate
// choice, never an implicit default -- ActionMenu for the choice, a
// small Dialog for the form that follows (same shape EntityRefField's
// own QuickCreateDialog uses for a minimal create form).
// "Table from a List" (goal 0105) is the third entry: the same form
// plus a List picker; the card lands INSIDE the current space (a
// projection is content of the board being viewed, so the
// sibling-vs-child question doesn't arise).
export function AtlasCreateMenu({ kinds, canAddSibling, onCreate, onCreateTable, onCreateTableNew, openChildRequest }: {
  kinds: Kind[]
  canAddSibling: boolean
  onCreate: (containment: Containment, kindID: string, title: string) => Promise<void>
  onCreateTable: (kindID: string, title: string, listID: string) => Promise<void>
  onCreateTableNew: (kindID: string, title: string) => Promise<void>
  // The board pane's right-click "Add card…" (goal 0075's audit G3):
  // AtlasView bumps this one-shot counter, this component opens the
  // SAME child-create form the toolbar's own "Add inside this card"
  // opens -- the dialog itself stays exactly as below, untouched.
  openChildRequest?: number
}) {
  const { t } = useTranslation('atlas')
  const [pending, setPending] = useState<PendingForm | null>(null)
  const [kindID, setKindID] = useState('')
  const [title, setTitle] = useState('')
  const [listID, setListID] = useState('')
  const [titleTouched, setTitleTouched] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const openForm = (form: PendingForm) => {
    setPending(form)
    setKindID(kinds[0]?.ID ?? '')
    setTitle('')
    setListID('')
    setTitleTouched(false)
    setError('')
  }

  const lastOpenChildRequest = useRef(openChildRequest)
  useEffect(() => {
    if (openChildRequest === undefined || openChildRequest === lastOpenChildRequest.current) return
    lastOpenChildRequest.current = openChildRequest
    openForm('child')
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the request tick alone, mirroring AtlasView's own atlasUpRequest signal
  }, [openChildRequest])

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
    if (!pending) return
    setSaving(true)
    setError('')
    try {
      if (pending === 'table') await onCreateTable(kindID, title, listID)
      else if (pending === 'table-new') await onCreateTableNew(kindID, title)
      else await onCreate(pending, kindID, title)
      setPending(null)
    } catch (err) {
      setError(String(err))
    } finally {
      setSaving(false)
    }
  }

  const dialogTitle = pending === 'sibling' ? t('create.addBeside')
    : pending === 'table' ? t('create.addTable')
      : pending === 'table-new' ? t('create.addTableNew') : t('create.addInside')

  return (
    <>
      <ActionMenu>
        <ActionMenu.Button leadingVisual={PlusIcon} variant="primary" size="small" data-testid="atlas-add-button">
          {t('create.addButton')}
        </ActionMenu.Button>
        <ActionMenu.Overlay>
          <ActionList>
            <ActionList.Item disabled={!canAddSibling} onSelect={() => openForm('sibling')} data-testid="atlas-add-sibling">
              {t('create.addBeside')}
            </ActionList.Item>
            <ActionList.Item onSelect={() => openForm('child')} data-testid="atlas-add-child">
              {t('create.addInside')}
            </ActionList.Item>
            <ActionList.Item onSelect={() => openForm('table-new')} data-testid="atlas-add-table-new">
              {t('create.addTableNew')}
            </ActionList.Item>
            <ActionList.Item onSelect={() => openForm('table')} data-testid="atlas-add-table">
              {t('create.addTable')}
            </ActionList.Item>
          </ActionList>
        </ActionMenu.Overlay>
      </ActionMenu>
      {pending && (
        <Dialog
          title={dialogTitle}
          onClose={() => setPending(null)}
          footerButtons={[
            { content: t('cancel'), onClick: () => setPending(null) },
            { content: t('create.createButton'), buttonType: 'primary', onClick: () => void submit(), disabled: saving || !title.trim() || !kindID || (pending === 'table' && !listID) },
          ]}
        >
          {pending === 'table' && (
            <FormControl>
              <FormControl.Label>{t('create.listLabel')}</FormControl.Label>
              <EntityRefField refKind="list" value={listID} onChange={pickList} />
              <FormControl.Caption>{t('create.listCaption')}</FormControl.Caption>
            </FormControl>
          )}
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
      )}
    </>
  )
}
