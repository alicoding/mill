import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Events } from '@wailsio/runtime'
import { ActionList, Text, TextInput } from '@primer/react'
import type { Kind } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import type { ContentEntry } from '../../bindings/github.com/alicoding/mill/internal/services/atlassvc/models'
import { AtlasService } from '../shared/bindings'
import { groupContents, kindLabelFor } from './atlasContentsIndex'
import runbookStyles from '../shared/ListCard.module.css'
import { background } from '../shared/background'

// The Contents view (docs/goals/0279): everything on the board,
// listed by kind with the names a person sees -- the user half of
// "how do you get a list of notes?". A projection pane of the board's
// region (goal 0355 S2: the view switcher's List segment, the
// atlas.contents.open command), mounted only while List is the active
// view; data from the bound content index every plugin's
// api.query already reads, refetched on every atlas dataevent while
// mounted. Row activation goes back to the board and acts there: a
// card opens its overlay, a note or object pans to it and pulses it.
export function AtlasContentsView({ kinds, onOpenCard, onFocusItem }: {
  kinds: Kind[]
  onOpenCard: (id: string) => void
  onFocusItem: (id: string) => void
}) {
  const { t } = useTranslation('atlas')
  const [entries, setEntries] = useState<ContentEntry[]>([])
  const [filter, setFilter] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  // The filter is what a person opens this view to type into, so it
  // takes focus on mount (a frame out, after the pane host's own focus
  // has landed).
  useEffect(() => {
    const id = requestAnimationFrame(() => inputRef.current?.focus())
    return () => cancelAnimationFrame(id)
  }, [])

  useEffect(() => {
    setFilter('')
    const refetch = () => { void background(AtlasService.ListContents('', '').then((e) => setEntries(e ?? [])), 'atlasContents.listContents') }
    refetch()
    return Events.On('mill-data-changed', (evt) => {
      const data = evt.data as { entity?: string } | undefined
      if (data?.entity === 'atlas') refetch()
    })
  }, [])

  const groups = useMemo(() => groupContents(entries, filter), [entries, filter])
  const titleByID = useMemo(() => new Map(entries.map((e) => [e.ID, e.Title])), [entries])

  const activate = (e: ContentEntry) => {
    if (e.Kind === 'card') onOpenCard(e.ID)
    else onFocusItem(e.ID)
  }
  return (
    <div data-component="atlas-contents-pane">
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
    </div>
  )
}
