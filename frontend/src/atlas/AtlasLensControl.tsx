import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Checkbox, CheckboxGroup, Dialog, FormControl, SegmentedControl } from '@primer/react'
import { FilterIcon } from '@primer/octicons-react'
import { ViewMode } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import type { Kind } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import type { AtlasDepth } from './useAtlasDepth'

// The per-space lens (docs/goals/0061): which Kinds stay visible among
// the viewed space's children, the depth toggle (this level only vs
// peek into children), and the view-mode switch for THIS space's own
// children (canvas/shelves, atlas.Card.ViewMode) -- one small Dialog
// rather than a popover, matching EntityRefField's own QuickCreateDialog
// shape for a compact settings form.
export function AtlasLensControl({ presentKinds, hiddenKindIDs, onChangeHidden, depth, onChangeDepth, viewMode, onChangeViewMode, showViewModeToggle }: {
  presentKinds: Kind[]
  hiddenKindIDs: string[]
  onChangeHidden: (hidden: string[]) => void
  depth: AtlasDepth
  onChangeDepth: (depth: AtlasDepth) => void
  viewMode: ViewMode
  onChangeViewMode: (mode: ViewMode) => void
  // Root (docs/goals/0061: "the virtual top") has no backing Card, so
  // there is no ViewMode field to persist a canvas/shelves choice for
  // it -- root always renders shelves, and this toggle is hidden rather
  // than shown-disabled-and-silently-ignored.
  showViewModeToggle: boolean
}) {
  const { t } = useTranslation('atlas')
  const [open, setOpen] = useState(false)
  const visibleIDs = presentKinds.map((k) => k.ID).filter((id) => !hiddenKindIDs.includes(id))

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
          {showViewModeToggle && (
            <SegmentedControl aria-label={t('lens.viewModeAriaLabel')} onChange={(i) => onChangeViewMode(i === 0 ? ViewMode.ViewModeShelves : ViewMode.ViewModeCanvas)}>
              <SegmentedControl.Button selected={viewMode !== ViewMode.ViewModeCanvas}>{t('lens.shelvesMode')}</SegmentedControl.Button>
              <SegmentedControl.Button selected={viewMode === ViewMode.ViewModeCanvas}>{t('lens.canvasMode')}</SegmentedControl.Button>
            </SegmentedControl>
          )}

          <SegmentedControl aria-label={t('lens.depthAriaLabel')} onChange={(i) => onChangeDepth(i === 0 ? 'level' : 'peek')}>
            <SegmentedControl.Button selected={depth === 'level'}>{t('lens.depthLevel')}</SegmentedControl.Button>
            <SegmentedControl.Button selected={depth === 'peek'}>{t('lens.depthPeek')}</SegmentedControl.Button>
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
