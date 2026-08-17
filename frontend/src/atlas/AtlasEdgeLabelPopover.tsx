import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AnchoredOverlay, TextInput } from '@primer/react'

// The edge menu's own "Edit label…" popover (goal 0081 slice A4,
// LOCKED design §6d): a single text field, saves on Enter -- same
// detached-anchor AnchoredOverlay shape AtlasPlacementPopover/
// ContextMenu already use, kept to its own tiny file since it carries
// none of the kind-picking machinery those two do.
export function AtlasEdgeLabelPopover({ anchorPos, initialLabel, onSubmit, onCancel }: {
  anchorPos: { x: number; y: number }
  initialLabel: string
  onSubmit: (label: string) => void
  onCancel: () => void
}) {
  const { t } = useTranslation('atlas')
  const anchorRef = useRef<HTMLDivElement>(null)
  const [label, setLabel] = useState(initialLabel)

  return (
    <>
      <div
        ref={anchorRef}
        style={{ position: 'fixed', left: anchorPos.x, top: anchorPos.y, width: 1, height: 1, pointerEvents: 'none' }}
        aria-hidden="true"
      />
      <AnchoredOverlay
        open
        onClose={onCancel}
        renderAnchor={null}
        anchorRef={anchorRef}
        overlayProps={{ role: 'dialog', 'aria-label': t('contextMenu.editLabel'), 'data-testid': 'atlas-edge-label-popover' } as never}
      >
        <div style={{ padding: '10px 12px' }}>
          <TextInput
            autoFocus
            block
            value={label}
            data-testid="atlas-edge-label-input"
            aria-label={t('contextMenu.editLabel')}
            onChange={(e) => setLabel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                onSubmit(label.trim())
              } else if (e.key === 'Escape') {
                e.preventDefault()
                onCancel()
              }
            }}
          />
        </div>
      </AnchoredOverlay>
    </>
  )
}
