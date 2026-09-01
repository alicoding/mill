import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ActionList, Dialog, TextInput } from '@primer/react'
import type { BoardObject, Card, Kind, Note } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { kindColorTokens } from './atlasKindColor'
import { AREA_FACET_KEY, filterJumpCards, filterJumpObjects } from './atlasJumpFilter'
import { matchFacetSuggestions, parseFacetQuery } from '../shared/facetQuery'
import type { FacetVocabEntry } from '../shared/facetQuery'
import { FacetChipRow } from '../shared/FacetChipRow'
import monoStyles from '../shared/monoText.module.css'
import styles from './AtlasJumpDialog.module.css'

// The ⌘K jump-to-a-card dialog (goal 0072 slice B): a global "go
// anywhere" entry point over every card, regardless of the currently
// viewed space -- distinct from AtlasPerspectiveSwitcher's own
// space-scoped popover. Purely controlled (goal 0071's registry
// surface-precedence reconciliation): `open` comes from AtlasView, which opens it off the
// atlas.jump command's own store signal (shared/uiSignalStore.ts) --
// this component no longer runs its own capture-phase window listener
// to win the ⌘K race against the app-wide command palette; dispatch
// order (shared/commands.ts's dispatchCommandForEvent) does that now.
export function AtlasJumpDialog({ open, onClose, cards, kinds, notes, objects, onJump, onJumpObject }: {
  open: boolean
  onClose: () => void
  cards: Card[]
  kinds: Kind[]
  // Board objects are jump peers (goal 0265) -- found by their
  // creation title / mirror basename, listed after card matches.
  objects: BoardObject[]
  // Notes feed the Area facet's frame-role law only (goal 0266) --
  // note text itself is deliberately not searched here.
  notes: Note[]
  // Consumed by AtlasView: re-roots when needed, then hands the target
  // card to AtlasBoard's own fly/pulse/hint sequence.
  onJump: (card: Card, openImmediately: boolean) => void
  // Same re-root-then-pulse plumbing, object flavored. No ⌘↵ open --
  // an object has no page overlay to open.
  onJumpObject: (object: BoardObject) => void
}) {
  const { t } = useTranslation('atlas')
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  // Reset the search/selection each time the dialog is (re)opened --
  // the same fresh-session reasoning the old capture-listener's own
  // setOpen(true) call used to bundle in.
  useEffect(() => {
    if (!open) return
    setQuery('')
    setActiveIndex(0)
  }, [open])

  // Faceted search (goal 0086): vocabulary is every Kind's own Label
  // plus the "area" role (group cards, orthogonal to Kind -- ADR-0038
  // Decision 3). parseFacetQuery/matchFacetSuggestions are the same
  // shared grammar the command palette and Quick Panel use.
  const vocabulary = useMemo<FacetVocabEntry[]>(
    () => [...kinds.map((k) => ({ key: k.ID, label: k.Label })), { key: AREA_FACET_KEY, label: t('jump.areaFacetLabel') }],
    [kinds, t],
  )
  const parsed = useMemo(() => parseFacetQuery(query, vocabulary), [query, vocabulary])
  const results = useMemo(() => filterJumpCards(cards, kinds, parsed.text, parsed.scopeKey, notes, objects), [cards, kinds, notes, objects, parsed])
  const objectResults = useMemo(() => filterJumpObjects(objects, cards, parsed.text, parsed.scopeKey), [objects, cards, parsed])
  const totalResults = results.length + objectResults.length
  const chipSuggestions = useMemo(
    () => (parsed.scopeKey || !query.trim() ? [] : matchFacetSuggestions(query, vocabulary)),
    [parsed.scopeKey, query, vocabulary],
  )

  const selectChip = (key: string) => {
    const entry = vocabulary.find((v) => v.key === key)
    if (!entry) return
    setQuery(`${entry.label}: `)
    setActiveIndex(0)
    inputRef.current?.focus()
  }

  const go = (card: Card) => {
    onClose()
    onJump(card, false)
  }
  const goOpen = (card: Card) => {
    onClose()
    onJump(card, true)
  }
  const goObject = (object: BoardObject) => {
    onClose()
    onJumpObject(object)
  }

  const onInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex((i) => Math.min(i + 1, Math.max(totalResults - 1, 0)))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const target = results[activeIndex]
      if (target) {
        if (e.metaKey || e.ctrlKey) goOpen(target.card)
        else go(target.card)
        return
      }
      // Object rows sit after the card rows in one arrow-key list;
      // ⌘↵ falls through to a plain jump (no page to open).
      const objectTarget = objectResults[activeIndex - results.length]
      if (objectTarget) goObject(objectTarget.object)
    }
  }

  if (!open) return null

  return (
    <Dialog
      title={t('jump.placeholder')}
      onClose={onClose}
      width="480px"
      initialFocusRef={inputRef}
      data-component="atlas-jump-dialog"
    >
      <TextInput
        ref={inputRef}
        block
        value={query}
        placeholder={t('jump.placeholder')}
        aria-label={t('jump.placeholder')}
        onChange={(e) => { setQuery(e.target.value); setActiveIndex(0) }}
        onKeyDown={onInputKeyDown}
        data-testid="atlas-jump-input"
      />
      <FacetChipRow
        items={chipSuggestions.map((entry) => ({
          key: entry.key,
          label: entry.label,
          dotColorToken: entry.key === AREA_FACET_KEY ? undefined : kindColorTokens(entry.key).emphasis,
        }))}
        onSelect={selectChip}
        ariaLabel={t('jump.suggestionsAriaLabel')}
      />
      <ActionList selectionVariant="single" data-testid="atlas-jump-results">
        {results.map((r, i) => {
          const tokens = kindColorTokens(r.card.KindID)
          return (
            <ActionList.Item
              key={r.card.ID}
              active={i === activeIndex}
              onSelect={() => go(r.card)}
              data-testid="atlas-jump-result"
            >
              <ActionList.LeadingVisual>
                <span className={styles.glyph} style={{ background: `var(${tokens.emphasis})` }}>
                  {(r.kind?.Label ?? '?').charAt(0).toUpperCase()}
                </span>
              </ActionList.LeadingVisual>
              <span className={styles.title}>{r.card.Title}</span>
              {r.path && (
                <ActionList.TrailingVisual>
                  <span className={`${styles.path} ${monoStyles.mono}`}>{r.path}</span>
                </ActionList.TrailingVisual>
              )}
            </ActionList.Item>
          )
        })}
        {objectResults.map((r, i) => (
          <ActionList.Item
            key={r.object.ID}
            active={results.length + i === activeIndex}
            onSelect={() => goObject(r.object)}
            data-testid="atlas-jump-object-result"
          >
            <ActionList.LeadingVisual>
              <span className={styles.glyph} style={{ background: 'var(--bgColor-neutral-emphasis)' }}>
                {r.object.Kind.charAt(0).toUpperCase()}
              </span>
            </ActionList.LeadingVisual>
            <span className={styles.title}>{r.label}</span>
            {r.path && (
              <ActionList.TrailingVisual>
                <span className={`${styles.path} ${monoStyles.mono}`}>{r.path}</span>
              </ActionList.TrailingVisual>
            )}
          </ActionList.Item>
        ))}
        {query.trim() !== '' && totalResults === 0 && (
          <ActionList.Item disabled data-testid="atlas-jump-no-matches">{t('jump.noMatches')}</ActionList.Item>
        )}
      </ActionList>
      <div className={`${styles.footer} ${monoStyles.mono}`}>{t('jump.footerHint')}</div>
    </Dialog>
  )
}
