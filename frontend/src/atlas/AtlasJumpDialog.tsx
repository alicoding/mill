import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ActionList, Dialog, TextInput } from '@primer/react'
import type { Card, Kind } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { kindColorTokens } from './atlasKindColor'
import { filterJumpCards } from './atlasJumpFilter'
import monoStyles from '../shared/monoText.module.css'
import styles from './AtlasJumpDialog.module.css'

// The ⌘K jump-to-a-card dialog (goal 0072 slice B): a global "go
// anywhere" entry point over every card, regardless of the currently
// viewed space -- distinct from AtlasLensControl's own space-scoped
// Dialog. Registers its own OPEN listener in the CAPTURE phase on
// window (not the bubble phase App.tsx's keymap dispatcher uses,
// shared/commands.ts's `palette.open`) so a ⌘K press while Atlas is
// mounted reaches this dialog first and never also opens the app-wide
// command palette -- see AtlasView.tsx's own comment on this surface
// for the tradeoff that scoping accepts.
function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable
}

export function AtlasJumpDialog({ cards, kinds, onJump }: {
  cards: Card[]
  kinds: Kind[]
  // Consumed by AtlasView: re-roots when needed, then hands the target
  // card to AtlasBoard's own fly/pulse/hint sequence.
  onJump: (card: Card, openImmediately: boolean) => void
}) {
  const { t } = useTranslation('atlas')
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (open) return
      if (e.key.toLowerCase() !== 'k' || !(e.metaKey || e.ctrlKey)) return
      if (isEditableTarget(e.target)) return
      e.preventDefault()
      e.stopPropagation()
      setQuery('')
      setActiveIndex(0)
      setOpen(true)
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [open])

  const results = useMemo(() => filterJumpCards(cards, kinds, query), [cards, kinds, query])

  const close = () => setOpen(false)

  const go = (card: Card) => {
    close()
    onJump(card, false)
  }
  const goOpen = (card: Card) => {
    close()
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
      onClose={close}
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
