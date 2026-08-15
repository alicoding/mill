import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Card, Kind, Link, LinkKind } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { ConfirmDialog } from '../shared/ConfirmDialog'

// ADR-0036 decision 3's UI visibility bar, adapted for a whole-graph
// bundle rather than the single-entity shape shared/useImportConfirm.tsx
// covers: Atlas has no per-entity export unit (this file's own doc
// comment on AtlasToolbar.tsx explains why), so a payload can carry
// several ids that already exist locally at once. Rather than naming
// every one (unbounded, unlike a single workflow/list's label), this
// confirms with a COUNT of how many entities across all four families
// will update in place -- still the same underlying guarantee (a
// collision is surfaced before anything is written, never silent), just
// summarized instead of enumerated.
interface ImportBundleIDs {
  kinds?: { id?: string }[]
  linkKinds?: { id?: string }[]
  cards?: { id?: string }[]
  links?: { id?: string }[]
}

export function useAtlasImportConfirm({ kinds, linkKinds, cards, links, onImport }: {
  kinds: Kind[]
  linkKinds: LinkKind[]
  cards: Card[]
  links: Link[]
  onImport: (jsonText: string) => void
}) {
  const { t } = useTranslation('atlas')
  const [pending, setPending] = useState<{ jsonText: string; updateCount: number } | null>(null)

  const requestImport = (jsonText: string) => {
    let bundle: ImportBundleIDs
    try {
      bundle = JSON.parse(jsonText) as ImportBundleIDs
    } catch {
      // Not valid JSON -- let onImport's own call surface the parse
      // error the same way it always has.
      onImport(jsonText)
      return
    }
    const kindIDs = new Set(kinds.map((k) => k.ID))
    const linkKindIDs = new Set(linkKinds.map((lk) => lk.ID))
    const cardIDs = new Set(cards.map((c) => c.ID))
    const linkIDs = new Set(links.map((l) => l.ID))
    const updateCount =
      (bundle.kinds ?? []).filter((k) => k.id && kindIDs.has(k.id)).length +
      (bundle.linkKinds ?? []).filter((lk) => lk.id && linkKindIDs.has(lk.id)).length +
      (bundle.cards ?? []).filter((c) => c.id && cardIDs.has(c.id)).length +
      (bundle.links ?? []).filter((l) => l.id && linkIDs.has(l.id)).length

    if (updateCount === 0) {
      onImport(jsonText)
      return
    }
    setPending({ jsonText, updateCount })
  }

  const dialog = pending && (
    <ConfirmDialog
      title={t('toolbar.importConfirmTitle')}
      body={t('toolbar.importConfirmBody', { count: pending.updateCount })}
      confirmLabel={t('toolbar.importConfirmButton')}
      onCancel={() => setPending(null)}
      onConfirm={() => {
        onImport(pending.jsonText)
        setPending(null)
      }}
    />
  )

  return { requestImport, dialog }
}
