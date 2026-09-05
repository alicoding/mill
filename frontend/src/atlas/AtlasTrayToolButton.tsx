import { Fragment, useRef } from 'react'
import type { ReactNode, RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import { AnchoredOverlay, Button } from '@primer/react'
import { LockIcon } from '@primer/octicons-react'
import { copy } from '../shared/copy'
import { AtlasTableSizePicker } from './AtlasTableSizePicker'
import { AtlasImageInput } from './AtlasImageInput'
import { AtlasStylePanel } from './AtlasStylePanel'
import { ATLAS_TOOL_DRAG_MIME } from './atlasTrayDrag'
import type { AtlasArmableTool, AtlasToolShape } from './atlasTools'
import styles from './AtlasCreationTray.module.css'

// Every tool's own dock button, wherever it renders -- a fixed dock
// slot, a flyout, or the slot a flyout gives up while one of its tools
// is armed. Split out of AtlasCreationTray.tsx (architecture.md's
// 500-line convention) once the dock grew a second flyout: the tray
// decides WHERE a button goes (atlasToolPlacement.ts), this file
// decides what one looks like and does, so a tool behaves identically
// in all three places.
//
// `withOverlay` is the tray's ONE-overlay invariant made explicit: at
// most one AnchoredOverlay in this family may be mounted at a time
// (AtlasCreationTray.tsx's own header has the pan regression that
// proved it), so the tray passes false whenever a flyout or the More
// panel already owns the overlay slot. The button itself is unchanged
// either way -- only its popover is withheld.
export interface AtlasTrayToolHandlers {
  onToggle: (tool: AtlasArmableTool) => void
  tablePickerOpen: boolean
  onTableToggle: (open: boolean) => void
  onClosePickerVisibility: () => void
  onPickTableSize: (cols: number, rows: number) => void
  onTableFromList: () => void
  imagePopoverOpen: boolean
  onImageToggle: (open: boolean) => void
  onImageSubmitPath: (path: string) => Promise<void>
  onImageSubmitFile: (file: File) => Promise<void>
  onImageSubmitText: (text: string) => Promise<void>
}

// armTool -- the ONE door that arms a tool by id, whichever surface
// asked (a dock button, a flyout entry, a More panel row). Routing off
// the tool's own declared interaction rather than its id means a plugin
// tool arms through the same call a built-in does.
export function armTool(tool: AtlasToolShape, handlers: AtlasTrayToolHandlers, armed: boolean): void {
  if (tool.interaction === 'pick-then-place') {
    handlers.onTableToggle(!armed)
    return
  }
  if (tool.interaction === 'paste-or-drop') {
    handlers.onImageToggle(!armed)
    return
  }
  handlers.onToggle(tool.id as AtlasArmableTool)
}

// isToolArmed -- Table and Image arm through a popover whose own
// visibility is narrower than armedness (a picked size leaves the tool
// armed for the placement click with nothing left to show), so Image
// reads its own flag for the pressed state, the way it always has.
function isToolArmed(tool: AtlasToolShape, armedTool: string | null, imagePopoverOpen: boolean): boolean {
  if (tool.interaction === 'paste-or-drop') return imagePopoverOpen
  return armedTool === tool.id
}

export function AtlasTrayToolButton({ tool, armedTool, locked, withOverlay, handlers }: {
  tool: AtlasToolShape
  armedTool: string | null
  locked: boolean
  withOverlay: boolean
  handlers: AtlasTrayToolHandlers
}) {
  const { t } = useTranslation('atlas')
  const anchorRef = useRef<HTMLButtonElement>(null)
  const Icon = tool.icon
  const armed = isToolArmed(tool, armedTool, handlers.imagePopoverOpen)
  // Locked reads only off the CURRENTLY armed tool (goal 0199 part D)
  // -- a stale `locked` from a since-disarmed tool must never paint a
  // different button.
  const isLocked = armedTool === tool.id && locked
  // A drag-from-tray placement lands via a single drop point
  // (creation.placeAt's own guard skips a gesture-declaring tool
  // outright, since its placement is a drawn gesture, never a click
  // point), so any gesture-declaring tool carries no drag source.
  const draggable = tool.gesture === null && tool.interaction === 'arm-then-click'

  const button = (
    <button
      ref={anchorRef}
      type="button"
      className={styles.tool}
      data-testid={`atlas-tray-${tool.id}`}
      data-armed={armed}
      data-locked={isLocked}
      aria-pressed={armed}
      title={isLocked
        ? t('creationTray.lockedTooltip', { tool: t(`creationTray.${tool.id}Label`, { defaultValue: copy(tool.label) }) })
        : t(`creationTray.${tool.id}Tooltip`, { defaultValue: copy(tool.description ?? tool.label) })}
      aria-label={t(`creationTray.${tool.id}Label`, { defaultValue: copy(tool.nounName) })}
      draggable={draggable}
      onDragStart={
        draggable
          ? (e) => {
              e.dataTransfer.setData(ATLAS_TOOL_DRAG_MIME, tool.id)
              e.dataTransfer.effectAllowed = 'copy'
            }
          : undefined
      }
      onClick={() => armTool(tool, handlers, armed)}
    >
      {isLocked ? <LockIcon size={14} /> : <Icon size={14} />}
      {tool.shortcutKey && <span className={styles.kbd}>{tool.shortcutKey}</span>}
    </button>
  )

  if (!withOverlay) return button
  return <ToolOverlay tool={tool} armedTool={armedTool} anchorRef={anchorRef} handlers={handlers}>{button}</ToolOverlay>
}

// The popover a tool floats above its own button -- a size picker, a
// paste zone, or a style panel, decided by the tool's own declared
// interaction and styleFields rather than a branch naming tools by id.
// Its own component so the button above stays one readable function.
function ToolOverlay({ tool, armedTool, anchorRef, handlers, children }: {
  tool: AtlasToolShape
  armedTool: string | null
  anchorRef: RefObject<HTMLButtonElement | null>
  handlers: AtlasTrayToolHandlers
  children: ReactNode
}) {
  const { t } = useTranslation('atlas')
  const button = children
  if (tool.interaction === 'pick-then-place') {
    return (
      <Fragment>
        {button}
        <AnchoredOverlay
          open={handlers.tablePickerOpen}
          onClose={() => handlers.onTableToggle(false)}
          anchorRef={anchorRef}
          renderAnchor={null}
          side="outside-top"
        >
          {/* Picking a size stays armed for the click-to-place phase
              (useTablePickerSignal.ts) -- closes only the popover's own
              visibility, never disarms. */}
          <AtlasTableSizePicker onPick={(cols, rows) => { handlers.onClosePickerVisibility(); handlers.onPickTableSize(cols, rows) }} />
          <div className={styles.pickerFooter}>
            <Button size="small" variant="invisible" data-testid="atlas-table-from-list" onClick={() => { handlers.onTableToggle(false); handlers.onTableFromList() }}>
              {t('creationTray.tableFromList')}
            </Button>
          </div>
        </AnchoredOverlay>
      </Fragment>
    )
  }

  if (tool.interaction === 'paste-or-drop') {
    return (
      <Fragment>
        {button}
        <AnchoredOverlay
          open={handlers.imagePopoverOpen}
          onClose={() => handlers.onImageToggle(false)}
          anchorRef={anchorRef}
          renderAnchor={null}
          side="outside-top"
        >
          <AtlasImageInput onSubmitPath={handlers.onImageSubmitPath} onSubmitFile={handlers.onImageSubmitFile} onSubmitText={handlers.onImageSubmitText} onDone={() => handlers.onImageToggle(false)} />
        </AnchoredOverlay>
      </Fragment>
    )
  }

  // Whether an options-bar panel floats above the button (goal 0169
  // slice 5, re-platformed goal 0209): registry-driven off the tool's
  // OWN styleFields declaration rather than a branch naming pencil or
  // shape here -- a THIRD styleable tool costs this nothing.
  if (tool.styleFields.length === 0) return button
  return (
    <Fragment>
      {button}
      <AnchoredOverlay
        open={armedTool === tool.id}
        // Deliberately NOT wired to disarm: AnchoredOverlay is fully
        // controlled by `open` (verified against its own source --
        // onClickOutside/onEscape only ever CALL onClose, they never
        // close anything themselves), so leaving this a no-op means
        // clicking the canvas to start a drag -- itself an "outside
        // click" against this popover -- never disarms the tool
        // mid-gesture.
        onClose={() => {}}
        anchorRef={anchorRef}
        renderAnchor={null}
        side="outside-top"
      >
        <AtlasStylePanel nounId={tool.id} fields={tool.styleFields} />
      </AnchoredOverlay>
    </Fragment>
  )
}
