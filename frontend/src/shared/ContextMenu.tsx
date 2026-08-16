import { useRef } from 'react'
import { ActionList, AnchoredOverlay } from '@primer/react'
import { findCommand } from './commands'
import { HotkeyHint } from './HotkeyHint'

// One right-click menu for every surface (goal 0075 -- the
// discoverability trilogy's third leg beside the shortcut and the
// palette): Primer-native via AnchoredOverlay's own documented
// detached-anchor mode (renderAnchor: null + an external anchorRef, a
// 1x1 fixed point at the pointer) wrapping an ActionList. Surfaces
// own WHAT the items are (they hold the target's context); this owns
// only how a menu looks and behaves. An item naming a commandId
// resolves its label from the command registry and renders the same
// live HotkeyHint the palette shows -- one label, one combo, three
// discovery surfaces that cannot drift.
export interface ContextMenuItem {
  id: string
  // Either a literal label or a commandId to resolve one from -- at
  // least one must be present.
  label?: string
  commandId?: string
  danger?: boolean
  disabled?: boolean
  divider?: boolean
  run?: () => void
}

export interface ContextMenuState {
  x: number
  y: number
  items: ContextMenuItem[]
}

export function ContextMenu({ state, onClose }: { state: ContextMenuState | null; onClose: () => void }) {
  const anchorRef = useRef<HTMLDivElement>(null)
  if (!state) return null

  return (
    <>
      <div
        ref={anchorRef}
        style={{ position: 'fixed', left: state.x, top: state.y, width: 1, height: 1, pointerEvents: 'none' }}
        aria-hidden="true"
      />
      <AnchoredOverlay
        open
        onClose={onClose}
        renderAnchor={null}
        anchorRef={anchorRef}
        overlayProps={{ role: 'menu', 'data-testid': 'context-menu' } as never}
      >
        <ActionList>
          {state.items.map((item) => {
            if (item.divider) return <ActionList.Divider key={item.id} />
            const label = item.label ?? (item.commandId ? findCommand(item.commandId)?.label : undefined) ?? item.id
            return (
              <ActionList.Item
                key={item.id}
                variant={item.danger ? 'danger' : 'default'}
                disabled={item.disabled}
                onSelect={() => {
                  onClose()
                  item.run?.()
                }}
              >
                {label}
                {item.commandId && (
                  <ActionList.TrailingVisual>
                    <HotkeyHint commandId={item.commandId} />
                  </ActionList.TrailingVisual>
                )}
              </ActionList.Item>
            )
          })}
        </ActionList>
      </AnchoredOverlay>
    </>
  )
}
