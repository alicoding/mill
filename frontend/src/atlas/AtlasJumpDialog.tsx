import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ActionList, Dialog, TextInput } from '@primer/react'
import type { Card, Kind } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { kindColorTokens } from './atlasKindColor'
import { AREA_FACET_KEY, filterJumpCards } from './atlasJumpFilter'
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
export function AtlasJumpDialog({ open, onClose, cards, kinds, onJump }: {
  open: boolean
  onClose: () => void
  cards: Card[]
  kinds: Kind[]
  // Consumed by AtlasView: re-roots when needed, then hands the target
  // card to AtlasBoard's own fly/pulse/hint sequence.
  onJump: (card: Card, openImmediately: boolean) => void
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
  const results = useMemo(() => filterJumpCards(cards, kinds, parsed.text, parsed.scopeKey), [cards, kinds, parsed])
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

  const onInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex((i) => Math.min(i + 1, Math.max(results.length - 1, 0)))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const target = results[activeIndex]
      if (!target) return
      if (e.metaKey || e.ctrlKey) goOpen(target.card)
      else go(target.card)
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
        {query.trim() !== '' && results.length === 0 && (
          <ActionList.Item disabled data-testid="atlas-jump-no-matches">{t('jump.noMatches')}</ActionList.Item>
        )}
      </ActionList>
      <div className={`${styles.footer} ${monoStyles.mono}`}>{t('jump.footerHint')}</div>
    </Dialog>
  )
}
