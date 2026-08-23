import { Fragment, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { AnchoredOverlay, Button } from '@primer/react'
import { AtlasTableSizePicker } from './AtlasTableSizePicker'
import { AtlasImageInput } from './AtlasImageInput'
import { AtlasPencilStylePicker } from './AtlasPencilStylePicker'
import { ATLAS_TOOLS, type AtlasArmableTool } from './atlasTools'
import styles from './AtlasCreationTray.module.css'

// The drag payload's own MIME key (goal 0081 slice A1) -- shared by
// this tray's onDragStart and AtlasBoard's own onDrop handler so a
// drag-from-tray placement and a click-to-arm placement land through
// the exact same "what tool, what point" contract. Area (slice A2)
// arms via click/bare-key like Card/Note, but its own placement is a
// drag-drawn rectangle, not a single drop point -- it carries no
// ATLAS_TOOL_DRAG_MIME payload of its own.
export const ATLAS_TOOL_DRAG_MIME = 'application/x-mill-atlas-tool'

// The creation toolbar (goal 0081's LOCKED design, section 2; goal
// 0139 made it THE creation surface -- every creatable thing is a
// visible tool here, nothing behind a dropdown). Every tool in the
// registry's own 'quick' tray renders through this one loop (goal
// 0169 slices 1-4) -- Card/Note/Area arm a placement on click
// ('arm-then-click'); Table opens its size picker anchored to its own
// button instead ('pick-then-place'), with "From a List…" in the
// picker's footer as the projection door; Image opens its own path/
// paste popover the same anchored way ('paste-or-drop'); Pencil arms
// on click too, but STAYS armed across strokes (AtlasBoard.tsx's own
// drag hook owns completion, never disarming itself), with its own
// colour/size options bar shown anchored for as long as it's the
// armed tool ('drag-to-draw'). Eraser and Laser ('drag-to-erase',
// 'ephemeral-drag') fall through to the same plain arm-on-click button
// the default branch below already renders for Card/Note/Area --
// neither needs an options popover, so no new branch was needed here
// at all; only their own drag gesture (AtlasBoard.tsx) differs. Hidden
// entirely below the companion breakpoint -- the caller (AtlasBoard)
// only renders this when !readOnly.
//
// Icon + shortcut-chip only, no visible text label (goal 0169 slice 4
// finding): a text label per button made the tray's own WIDTH grow
// unboundedly with every tool this registry gains -- confirmed live
// when the 8th button (Laser) widened the tray enough to push its
// LEFT edge over a fixed test coordinate an unrelated spec clicked
// near the board's bottom-left. Matches the converged pattern this
// goal's own research already cited (Excalidraw/tldraw toolbars are
// icon-only for exactly this reason) rather than trimming padding by a
// few px, which would only defer the same class of collision to slice
// 5's shapes tool. The full name is still discoverable via `title`
// (hover) and `aria-label` (screen readers) on every button.
export function AtlasCreationTray({ armedTool, onToggle, tablePickerOpen, onTableToggle, onPickTableSize, onTableFromList, imagePopoverOpen, onImageToggle, onImageSubmitPath, onImageSubmitFile }: {
  armedTool: AtlasArmableTool | null
  onToggle: (tool: AtlasArmableTool) => void
  tablePickerOpen: boolean
  onTableToggle: (open: boolean) => void
  onPickTableSize: (cols: number, rows: number) => void
  onTableFromList: () => void
  imagePopoverOpen: boolean
  onImageToggle: (open: boolean) => void
  onImageSubmitPath: (path: string) => Promise<void>
  onImageSubmitFile: (file: File) => Promise<void>
}) {
  const { t } = useTranslation('atlas')
  const tools = ATLAS_TOOLS.filter((tool) => tool.tray === 'quick')
  const tableButtonRef = useRef<HTMLButtonElement>(null)
  const imageButtonRef = useRef<HTMLButtonElement>(null)
  const pencilButtonRef = useRef<HTMLButtonElement>(null)

  return (
    <div className={styles.tray} data-testid="atlas-creation-tray" role="toolbar" aria-label={t('creationTray.ariaLabel')}>
      {tools.map((tool) => {
        const Icon = tool.icon
        if (tool.interaction === 'pick-then-place') {
          return (
            <Fragment key={tool.id}>
              <button
                ref={tableButtonRef}
                type="button"
                className={styles.tool}
                data-testid={`atlas-tray-${tool.id}`}
                data-armed={tablePickerOpen}
                aria-pressed={tablePickerOpen}
                title={t(`creationTray.${tool.id}Tooltip`)}
                aria-label={t(`creationTray.${tool.id}Label`)}
                onClick={() => onTableToggle(!tablePickerOpen)}
              >
                <Icon size={14} />
                <span className={styles.kbd}>{tool.shortcutKey}</span>
              </button>
              <AnchoredOverlay
                open={tablePickerOpen}
                onClose={() => onTableToggle(false)}
                anchorRef={tableButtonRef}
                renderAnchor={null}
                side="outside-top"
              >
                <AtlasTableSizePicker onPick={(cols, rows) => { onTableToggle(false); onPickTableSize(cols, rows) }} />
                <div className={styles.pickerFooter}>
                  <Button size="small" variant="invisible" data-testid="atlas-table-from-list" onClick={() => { onTableToggle(false); onTableFromList() }}>
                    {t('creationTray.tableFromList')}
                  </Button>
                </div>
              </AnchoredOverlay>
            </Fragment>
          )
        }
        if (tool.interaction === 'drag-to-draw') {
          const pencilArmed = armedTool === tool.id
          return (
            <Fragment key={tool.id}>
              <button
                ref={pencilButtonRef}
                type="button"
                className={styles.tool}
                data-testid={`atlas-tray-${tool.id}`}
                data-armed={pencilArmed}
                aria-pressed={pencilArmed}
                title={t(`creationTray.${tool.id}Tooltip`)}
                aria-label={t(`creationTray.${tool.id}Label`)}
                onClick={() => onToggle(tool.id)}
              >
                <Icon size={14} />
                <span className={styles.kbd}>{tool.shortcutKey}</span>
              </button>
              <AnchoredOverlay
                open={pencilArmed}
                // Deliberately NOT wired to disarm: AnchoredOverlay is
                // fully controlled by `open` (verified against its own
                // source -- onClickOutside/onEscape only ever CALL
                // onClose, they never close anything themselves), so
                // leaving this a no-op means clicking the canvas to
                // start a stroke -- itself an "outside click" against
                // this popover -- never disarms the tool mid-gesture.
                // Only the tray button, Escape, or picking another
                // tool changes armedTool, all already wired elsewhere.
                onClose={() => {}}
                anchorRef={pencilButtonRef}
                renderAnchor={null}
                side="outside-top"
              >
                <AtlasPencilStylePicker />
              </AnchoredOverlay>
            </Fragment>
          )
        }
        if (tool.interaction === 'paste-or-drop') {
          return (
            <Fragment key={tool.id}>
              <button
                ref={imageButtonRef}
                type="button"
                className={styles.tool}
                data-testid={`atlas-tray-${tool.id}`}
                data-armed={imagePopoverOpen}
                aria-pressed={imagePopoverOpen}
                title={t(`creationTray.${tool.id}Tooltip`)}
                aria-label={t(`creationTray.${tool.id}Label`)}
                onClick={() => onImageToggle(!imagePopoverOpen)}
              >
                <Icon size={14} />
                <span className={styles.kbd}>{tool.shortcutKey}</span>
              </button>
              <AnchoredOverlay
                open={imagePopoverOpen}
                onClose={() => onImageToggle(false)}
                anchorRef={imageButtonRef}
                renderAnchor={null}
                side="outside-top"
              >
                <AtlasImageInput onSubmitPath={onImageSubmitPath} onSubmitFile={onImageSubmitFile} onDone={() => onImageToggle(false)} />
              </AnchoredOverlay>
            </Fragment>
          )
        }
        const armed = armedTool === tool.id
        // A drag-from-tray placement lands via a single drop point
        // (creation.placeAt's own guard skips these three ids
        // outright, since their placement is a drawn gesture, never a
        // click point) -- Area, Eraser, and Laser carry no drag source.
        const draggable = tool.id !== 'area' && tool.id !== 'eraser' && tool.id !== 'laser'
        return (
          <button
            key={tool.id}
            type="button"
            className={styles.tool}
            data-testid={`atlas-tray-${tool.id}`}
            data-armed={armed}
            aria-pressed={armed}
            title={t(`creationTray.${tool.id}Tooltip`)}
            aria-label={t(`creationTray.${tool.id}Label`)}
            draggable={draggable}
            onDragStart={
              draggable
                ? (e) => {
                    e.dataTransfer.setData(ATLAS_TOOL_DRAG_MIME, tool.id)
                    e.dataTransfer.effectAllowed = 'copy'
                  }
                : undefined
            }
            onClick={() => onToggle(tool.id)}
          >
            <Icon size={14} />
            <span className={styles.kbd}>{tool.shortcutKey}</span>
          </button>
        )
      })}
    </div>
  )
}
