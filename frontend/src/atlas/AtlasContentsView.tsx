import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Events } from '@wailsio/runtime'
import { ActionList, Dialog, Text, TextInput } from '@primer/react'
import type { Kind } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import type { ContentEntry } from '../../bindings/github.com/alicoding/mill/internal/services/atlassvc/models'
import { AtlasService } from '../shared/bindings'
import { groupContents, kindLabelFor } from './atlasContentsIndex'
import runbookStyles from '../shared/ListCard.module.css'
import { background } from '../shared/background'

// The Contents dialog (docs/goals/0279): everything on the board,
// listed by kind with the names a person sees -- the user half of
// "how do you get a list of notes?". Hosted exactly like the matrix
// and roadmap dialogs (toolbar button + the atlas.contents.open
// command), data from the bound content index every plugin's
// api.query already reads, refetched on every atlas dataevent while
// open. Row activation closes the dialog and jumps: a card opens its
// overlay, a note or object pans to it and pulses it.
export function AtlasContentsView({ open, onClose, kinds, onOpenCard, onFocusItem }: {
  open: boolean
  onClose: () => void
  kinds: Kind[]
  onOpenCard: (id: string) => void
  onFocusItem: (id: string) => void
}) {
  const { t } = useTranslation('atlas')
  const [entries, setEntries] = useState<ContentEntry[]>([])
  const [filter, setFilter] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  // The kit's dialog claims initial focus for itself on mount; the
  // filter is what a person opens this to type into, so it takes focus
  // right after (next frame, once the dialog's own focus move is done).
  useEffect(() => {
    if (!open) return
    const id = requestAnimationFrame(() => inputRef.current?.focus())
    return () => cancelAnimationFrame(id)
  }, [open])

  useEffect(() => {
    if (!open) return
    setFilter('')
    const refetch = () => { void background(AtlasService.ListContents('', '').then((e) => setEntries(e ?? [])), 'atlasContents.listContents') }
    refetch()
    return Events.On('mill-data-changed', (evt) => {
      const data = evt.data as { entity?: string } | undefined
      if (data?.entity === 'atlas') refetch()
    })
  }, [open])

  const groups = useMemo(() => groupContents(entries, filter), [entries, filter])
  const titleByID = useMemo(() => new Map(entries.map((e) => [e.ID, e.Title])), [entries])

  if (!open) return null
  const activate = (e: ContentEntry) => {
    onClose()
    if (e.Kind === 'card') onOpenCard(e.ID)
    else onFocusItem(e.ID)
  }
  return (
    <Dialog title={t('contents.title')} onClose={onClose} width="min(720px, calc(100vw - 64px))" data-component="atlas-contents-dialog">
      {/* Wrapper carries the testid: the kit's input forwards it inconsistently. */}
      <div data-testid="atlas-contents-filter">
        <TextInput
          ref={inputRef}
          block
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={t('contents.filterPlaceholder')}
          aria-label={t('contents.filterPlaceholder')}
        />
      </div>
      {groups.length === 0 ? (
        <Text as="p" size="small" className={runbookStyles.muted} data-testid="atlas-contents-empty">{t('contents.empty')}</Text>
      ) : (
        <ActionList aria-label={t('contents.title')} data-testid="atlas-contents-list">
          {groups.map((g) => (
            <ActionList.Group key={g.kind} data-testid={`atlas-contents-group-${g.kind}`}>
              <ActionList.GroupHeading as="h3">{g.label} · {g.entries.length}</ActionList.GroupHeading>
              {g.entries.map((e) => (
                <ActionList.Item key={e.ID} onSelect={() => activate(e)} data-testid="atlas-contents-row" data-kind={e.Kind} data-title={e.Title}>
                  <ActionList.LeadingVisual><g.Icon size={14} /></ActionList.LeadingVisual>
                  {e.Title}
                  {(kindLabelFor(e, kinds) || e.ParentID) && (
                    <ActionList.Description>
                      {[kindLabelFor(e, kinds), e.ParentID ? titleByID.get(e.ParentID) : undefined].filter(Boolean).join(' · ')}
                    </ActionList.Description>
                  )}
                </ActionList.Item>
              ))}
            </ActionList.Group>
          ))}
        </ActionList>
      )}
    </Dialog>
  )
}
