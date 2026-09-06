import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ActionList, ActionMenu, Checkbox, FormControl, IconButton, TextInput } from '@primer/react'
import { CheckIcon, EyeIcon, KebabHorizontalIcon } from '@primer/octicons-react'
import type { Card, Kind, Link, LinkKind, Perspective } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { useUISignalStore } from '../shared/uiSignalStore'
import { ContextMenu, type ContextMenuState } from '../shared/ContextMenu'
import { entityRowContext } from '../shared/entityRowCommands'
import { AtlasPerspectiveCompareDialog } from './AtlasPerspectiveCompareDialog'
import styles from './AtlasPerspectiveSwitcher.module.css'

// The board toolbar's primary view control (ADR-0041, goal 0095 slice
// 2): absorbs the old Lens popover's slot entirely -- "All cards" (the
// default absence of a Perspective) first, every perspective in this
// space's own order, a divider, then an inline "New perspective..."
// row. The retired Lens control's depth/peek toggle predated the click
// model and was consumed by nothing (docs/SPEC.md's own recorded
// seam) -- it does not come back here. Its still-live half, the
// kind-hide filter, demotes into this popover's own "Hide kinds"
// section per the ADR's UI-naming note: never two near-synonym view
// controls side by side.
export function AtlasPerspectiveSwitcher({
  perspectives, activePerspectiveID, onSwitch, onCreate, onRename, onDelete, onToast,
  presentKinds, hiddenKindIDs, onChangeHidden,
  cards, links, kinds, linkKinds,
}: {
  perspectives: Perspective[]
  activePerspectiveID: string
  onSwitch: (id: string) => void
  onCreate: (name: string) => Promise<void>
  onRename: (id: string, name: string) => Promise<void>
  onDelete: (id: string) => Promise<void>
  onToast: (message: string) => void
  presentKinds: Kind[]
  hiddenKindIDs: string[]
  onChangeHidden: (hidden: string[]) => void
  // The Compare view's own full-graph data (goal 0095 slice 3) --
  // deliberately the UNFILTERED sets (never boardAllCards/presentKinds,
  // both scoped to the currently viewed space), since a diff's added/
  // removed members can live anywhere in the tree.
  cards: Card[]
  links: Link[]
  kinds: Kind[]
  linkKinds: LinkKind[]
}) {
  const { t } = useTranslation('atlas')
  const [open, setOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [renamingID, setRenamingID] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const [rowMenu, setRowMenu] = useState<ContextMenuState | null>(null)
  const [compareOpen, setCompareOpen] = useState(false)
  const visibleIDs = presentKinds.map((k) => k.ID).filter((id) => !hiddenKindIDs.includes(id))

  const active = perspectives.find((p) => p.ID === activePerspectiveID) ?? null

  // atlas.perspective's own signal (shared/atlasBoardCommands.ts): a
  // palette/keyboard invocation opens the SAME popover the toolbar's
  // own button does.
  const openRequest = useUISignalStore((s) => s.atlasPerspectiveSwitcherOpenRequest)
  const lastOpenRequest = useRef(openRequest)
  useEffect(() => {
    if (openRequest === lastOpenRequest.current) return
    lastOpenRequest.current = openRequest
    setOpen(true)
  }, [openRequest])

  const closeRowMenu = () => setRowMenu(null)

  // The two row commands land here (goal 0346 slice B): rename opens
  // the inline field, delete (already confirmed by the menu) runs the
  // same onDelete the dialog used to.
  const renameRequest = useUISignalStore((s) => s.atlasPerspectiveRenameRequest)
  useEffect(() => {
    if (!renameRequest) return
    const p = perspectives.find((x) => x.ID === renameRequest.id)
    if (p) { setRenamingID(p.ID); setRenameDraft(p.Name) }
    // perspectives is read at request time only -- the request is the trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [renameRequest])
  const deleteRequest = useUISignalStore((s) => s.atlasPerspectiveDeleteRequest)
  useEffect(() => {
    if (!deleteRequest) return
    void onDelete(deleteRequest.id).catch((err) => onToast(String(err)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deleteRequest])

  const openRowMenu = (p: Perspective, pos: { x: number; y: number }) => {
    setRowMenu({
      x: pos.x,
      y: pos.y,
      items: [
        { id: 'rename', label: t('perspective.rename'), commandId: 'perspective.row.rename', ctx: entityRowContext('perspective', p.ID) },
        { id: 'delete', label: t('perspective.delete'), commandId: 'perspective.row.delete', ctx: entityRowContext('perspective', p.ID), danger: true },
      ],
    })
  }

  const commitRename = (p: Perspective) => {
    const name = renameDraft.trim()
    setRenamingID(null)
    if (!name || name === p.Name) return
    void onRename(p.ID, name).catch((err) => onToast(String(err)))
  }

  const submitCreate = () => {
    const name = newName.trim()
    if (!name) return
    setNewName('')
    // Closes only on success (symmetric with a row's own onSelect close)
    // -- a create failure leaves the popover open with its draft name
    // gone but the toast visible, rather than silently vanishing.
    void onCreate(name).then(() => setOpen(false)).catch((err) => onToast(String(err)))
  }


  return (
    <>
      <ActionMenu open={open} onOpenChange={setOpen}>
        <ActionMenu.Button leadingVisual={EyeIcon} size="small" variant="invisible" data-testid="atlas-perspective-switcher-open">
          {active ? active.Name : t('perspective.allCards')}
        </ActionMenu.Button>
        {/* ActionMenu.Overlay hardcodes its own data-component
            ("ActionMenu.Overlay") and drops a caller-supplied one
            (AtlasCardOverlay.tsx's Dialog note is the same constraint,
            different component) -- the testid goes on ActionList
            itself instead, which spreads its own rest props onto the
            rendered <ul>. */}
        <ActionMenu.Overlay>
          <ActionList selectionVariant="single" data-testid="atlas-perspective-switcher-popover">
            <ActionList.Item
              selected={activePerspectiveID === ''}
              data-testid="atlas-perspective-item-all"
              onSelect={() => { onSwitch(''); setOpen(false) }}
            >
              {t('perspective.allCards')}
              {activePerspectiveID === '' && (
                <ActionList.TrailingVisual>
                  <CheckIcon size={14} />
                </ActionList.TrailingVisual>
              )}
            </ActionList.Item>
            {perspectives.length > 0 && <ActionList.Divider />}
            {perspectives.map((p) => (
              <ActionList.Item
                key={p.ID}
                selected={p.ID === activePerspectiveID}
                data-testid={`atlas-perspective-item-${p.ID}`}
                onSelect={renamingID === p.ID ? undefined : () => { onSwitch(p.ID); setOpen(false) }}
                onContextMenu={(e) => { e.preventDefault(); openRowMenu(p, { x: e.clientX, y: e.clientY }) }}
              >
                {renamingID === p.ID ? (
                  <TextInput
                    autoFocus
                    size="small"
                    value={renameDraft}
                    data-testid="atlas-perspective-rename-input"
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => setRenameDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { e.preventDefault(); commitRename(p) }
                      if (e.key === 'Escape') { e.preventDefault(); setRenamingID(null) }
                    }}
                    onBlur={() => commitRename(p)}
                  />
                ) : (
                  p.Name
                )}
                <ActionList.TrailingVisual>
                  {p.ID === activePerspectiveID && renamingID !== p.ID && <CheckIcon size={14} />}
                  <IconButton
                    icon={KebabHorizontalIcon}
                    size="small"
                    variant="invisible"
                    aria-label={t('perspective.rowMenuAriaLabel', { name: p.Name })}
                    data-testid={`atlas-perspective-kebab-${p.ID}`}
                    onClick={(e) => { e.stopPropagation(); openRowMenu(p, { x: e.clientX, y: e.clientY }) }}
                  />
                </ActionList.TrailingVisual>
              </ActionList.Item>
            ))}
            <ActionList.Divider />
            <div className={styles.newRow}>
              <TextInput
                placeholder={t('perspective.newPerspectivePlaceholder')}
                size="small"
                block
                value={newName}
                data-testid="atlas-perspective-new-input"
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); submitCreate() }
                }}
              />
            </div>
            {perspectives.length >= 2 && (
              <ActionList.Item
                data-testid="atlas-perspective-compare-open"
                onSelect={() => { setOpen(false); setCompareOpen(true) }}
              >
                {t('perspective.comparePerspectives')}
              </ActionList.Item>
            )}
            {presentKinds.length > 0 && (
              <>
                <ActionList.Divider />
                <ActionList.Group title={t('perspective.hideKindsLabel')}>
                  {presentKinds.map((kind) => (
                    <FormControl key={kind.ID} className={styles.kindRow}>
                      <Checkbox
                        value={kind.ID}
                        checked={visibleIDs.includes(kind.ID)}
                        data-testid="atlas-perspective-kind-checkbox"
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
                </ActionList.Group>
              </>
            )}
          </ActionList>
        </ActionMenu.Overlay>
      </ActionMenu>
      <ContextMenu state={rowMenu} onClose={closeRowMenu} />
      <AtlasPerspectiveCompareDialog
        open={compareOpen}
        onClose={() => setCompareOpen(false)}
        perspectives={perspectives}
        cards={cards}
        links={links}
        kinds={kinds}
        linkKinds={linkKinds}
        onError={onToast}
      />
    </>
  )
}
