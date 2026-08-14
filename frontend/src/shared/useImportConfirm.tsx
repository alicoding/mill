import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ConfirmDialog } from './ConfirmDialog'

// ADR-0036 decision 3's UI visibility bar: a file-picker import whose
// payload id matches a locally known entity UPDATES it rather than
// creating a new one, so that must be confirmed first, naming the
// entity -- never a silent overwrite. Mirrors useConfirmDelete.tsx's
// state-glue shape (same reuse rule: a fifth near-identical page wiring
// is the signal to share it, once across CompositionView and five
// Configure pages), reading the payload's own "id" field rather than
// requiring each caller to pre-parse it.
export function useImportConfirm<T extends { ID: string; Label: string }>({
  existing, onImport,
}: {
  existing: T[]
  onImport: (jsonText: string) => void
}) {
  const { t } = useTranslation('common')
  const [pending, setPending] = useState<{ jsonText: string; label: string } | null>(null)

  const requestImport = (jsonText: string) => {
    let id: string | undefined
    try {
      const parsed = JSON.parse(jsonText) as { id?: string }
      id = parsed.id
    } catch {
      // Not valid JSON -- let onImport's own call surface the parse
      // error the same way it always has.
      onImport(jsonText)
      return
    }
    const match = id ? existing.find((e) => e.ID === id) : undefined
    if (!match) {
      onImport(jsonText)
      return
    }
    setPending({ jsonText, label: match.Label })
  }

  const dialog = pending && (
    <ConfirmDialog
      title={t('importConfirm.title')}
      body={t('importConfirm.body', { label: pending.label })}
      confirmLabel={t('importConfirm.confirm')}
      onCancel={() => setPending(null)}
      onConfirm={() => {
        onImport(pending.jsonText)
        setPending(null)
      }}
    />
  )

  return { requestImport, dialog }
}
