import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Checkbox, CheckboxGroup, Dialog, FormControl, SegmentedControl } from '@primer/react'
import { FilterIcon } from '@primer/octicons-react'
import type { Kind } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { useUISignalStore } from '../shared/uiSignalStore'

// The per-space lens (docs/goals/0061): which Kinds stay visible among
// the viewed space's children, and the depth toggle (this level only vs
// peek into children) -- one small Dialog rather than a popover,
// matching EntityRefField's own QuickCreateDialog shape for a compact
// settings form. The canvas/shelves view-mode switch moved out to
// AtlasToolbar (goal 0069): it's the current space's primary,
// always-visible affordance, not a setting buried behind this Dialog.
export function AtlasLensControl({ presentKinds, hiddenKindIDs, onChangeHidden, peek, onChangePeek }: {
  presentKinds: Kind[]
  hiddenKindIDs: string[]
  onChangeHidden: (hidden: string[]) => void
  peek: boolean
  onChangePeek: (peek: boolean) => void
}) {
  const { t } = useTranslation('atlas')
  const [open, setOpen] = useState(false)
  const visibleIDs = presentKinds.map((k) => k.ID).filter((id) => !hiddenKindIDs.includes(id))

  // atlas.lens's own signal (shared/atlasBoardCommands.ts): a palette/
  // keyboard invocation opens the SAME dialog the toolbar's own lens
  // button does.
  const lensOpenRequest = useUISignalStore((s) => s.atlasLensOpenRequest)
  const lastLensOpenRequest = useRef(lensOpenRequest)
  useEffect(() => {
    if (lensOpenRequest === lastLensOpenRequest.current) return
    lastLensOpenRequest.current = lensOpenRequest
    setOpen(true)
  }, [lensOpenRequest])

  return (
    <>
      <Button leadingVisual={FilterIcon} size="small" variant="invisible" data-testid="atlas-lens-open" onClick={() => setOpen(true)}>
        {t('lens.openButton')}
      </Button>
      {open && (
        // data-component, not data-testid: Primer's Dialog only forwards
        // its own special-cased "data-component" prop onto the rendered
        // element (see AtlasCardOverlay.tsx's identical note).
        <Dialog title={t('lens.title')} onClose={() => setOpen(false)} data-component="atlas-lens-dialog">
          <SegmentedControl aria-label={t('lens.depthAriaLabel')} onChange={(i) => onChangePeek(i === 1)}>
            <SegmentedControl.Button selected={!peek}>{t('lens.depthLevel')}</SegmentedControl.Button>
            <SegmentedControl.Button selected={peek}>{t('lens.depthPeek')}</SegmentedControl.Button>
          </SegmentedControl>

          {presentKinds.length > 0 && (
            <CheckboxGroup>
              <CheckboxGroup.Label>{t('lens.kindsLabel')}</CheckboxGroup.Label>
              {presentKinds.map((kind) => (
                // Checkbox is a bare <input type="checkbox"> (no
                // children/label support of its own, unlike Checkbox's
                // sibling controls) -- FormControl.Label is what gives
                // it an accessible, visible label, same pairing every
                // other Checkbox in this codebase uses.
                <FormControl key={kind.ID}>
                  <Checkbox
                    value={kind.ID}
                    checked={visibleIDs.includes(kind.ID)}
                    data-testid="atlas-lens-kind-checkbox"
                    onChange={(e) => {
                      const nextHidden = e.target.checked
                        ? hiddenKindIDs.filter((id) => id !== kind.ID)
                        : [...hiddenKindIDs, kind.ID]
                      onChangeHidden(nextHidden)
                    }}
                  />
                  <FormControl.Label>{kind.Icon ? `${kind.Icon} ${kind.Label}` : kind.Label}</FormControl.Label>
                </FormControl>
              ))}
            </CheckboxGroup>
          )}
        </Dialog>
      )}
    </>
  )
}
