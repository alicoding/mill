import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ActionList, ActionMenu, Dialog, FormControl, TextInput } from '@primer/react'
import { PlusIcon } from '@primer/octicons-react'
import type { Kind } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { KindPicker } from './KindPicker'

type Containment = 'sibling' | 'child'

// The "+" affordance (docs/goals/0061): asks sibling-vs-child EXPLICITLY
// before asking for a Kind/title, so containment is always a deliberate
// choice, never an implicit default -- ActionMenu for the two-way
// choice, a small Dialog for the kind+title form that follows (same
// shape EntityRefField's own QuickCreateDialog uses for a minimal
// create form).
export function AtlasCreateMenu({ kinds, canAddSibling, onCreate, openChildRequest }: {
  kinds: Kind[]
  canAddSibling: boolean
  onCreate: (containment: Containment, kindID: string, title: string) => Promise<void>
  // The board pane's right-click "Add card…" (goal 0075's audit G3):
  // AtlasView bumps this one-shot counter, this component opens the
  // SAME child-create form the toolbar's own "Add inside this card"
  // opens -- the dialog itself stays exactly as below, untouched.
  openChildRequest?: number
}) {
  const { t } = useTranslation('atlas')
  const [pending, setPending] = useState<Containment | null>(null)
  const [kindID, setKindID] = useState('')
  const [title, setTitle] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const openForm = (containment: Containment) => {
    setPending(containment)
    setKindID(kinds[0]?.ID ?? '')
    setTitle('')
    setError('')
  }

  const lastOpenChildRequest = useRef(openChildRequest)
  useEffect(() => {
    if (openChildRequest === undefined || openChildRequest === lastOpenChildRequest.current) return
    lastOpenChildRequest.current = openChildRequest
    openForm('child')
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the request tick alone, mirroring AtlasView's own atlasUpRequest signal
  }, [openChildRequest])

  const submit = async () => {
    if (!pending) return
    setSaving(true)
    setError('')
    try {
      await onCreate(pending, kindID, title)
      setPending(null)
    } catch (err) {
      setError(String(err))
    } finally {
      setSaving(false)
    }
  }

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
          </ActionList>
        </ActionMenu.Overlay>
      </ActionMenu>
      {pending && (
        <Dialog
          title={pending === 'sibling' ? t('create.addBeside') : t('create.addInside')}
          onClose={() => setPending(null)}
          footerButtons={[
            { content: t('cancel'), onClick: () => setPending(null) },
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
      )}
    </>
  )
}
