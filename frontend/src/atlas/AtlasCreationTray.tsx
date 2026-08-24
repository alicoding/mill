import { createRef, Fragment, useMemo } from 'react'
import type { RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import { AnchoredOverlay, Button } from '@primer/react'
import { AtlasTableSizePicker } from './AtlasTableSizePicker'
import { AtlasImageInput } from './AtlasImageInput'
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
// armed tool ('drag-to-draw'); Shape (goal 0169 slice 5) shares that
// same interaction and branch, its own options bar swapped in via the
// tool's own StylePicker field rather than a second branch. Eraser and
// Laser ('drag-to-erase',
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
  // One anchor ref PER TOOL ID (not one shared ref reused across every
  // mapped button) -- created once, since ATLAS_TOOLS is a module-level
  // constant whose ids never change across renders. A single shared ref
  // was the pre-slice-5 shape here: it silently worked only because
  // pencil was the sole 'drag-to-draw' tool ever mounted at once: a
  // second one (shape) reusing the SAME ref object would make both
  // AnchoredOverlays anchor to whichever DOM node happened to render
  // last.
  const anchorRefs = useMemo(
    () => Object.fromEntries(tools.map((tool) => [tool.id, createRef<HTMLButtonElement>()])) as Record<string, RefObject<HTMLButtonElement | null>>,
    [tools],
  )

  return (
    <div className={styles.tray} data-testid="atlas-creation-tray" role="toolbar" aria-label={t('creationTray.ariaLabel')}>
      {tools.map((tool) => {
        const Icon = tool.icon
        if (tool.interaction === 'pick-then-place') {
          return (
            <Fragment key={tool.id}>
              <button
                ref={anchorRefs[tool.id]}
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
                anchorRef={anchorRefs[tool.id]}
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
          const dragArmed = armedTool === tool.id
          // Which options-bar component floats above the button (goal
          // 0169 slice 5): registry-driven off the tool's OWN
          // StylePicker field (atlasTools.ts) rather than a branch
          // naming pencil/shape here -- a THIRD drag-to-draw tool costs
          // this branch nothing.
          const StylePicker = tool.StylePicker
          return (
            <Fragment key={tool.id}>
              <button
                ref={anchorRefs[tool.id]}
                type="button"
                className={styles.tool}
                data-testid={`atlas-tray-${tool.id}`}
                data-armed={dragArmed}
                aria-pressed={dragArmed}
                title={t(`creationTray.${tool.id}Tooltip`)}
                aria-label={t(`creationTray.${tool.id}Label`)}
                onClick={() => onToggle(tool.id)}
              >
                <Icon size={14} />
                <span className={styles.kbd}>{tool.shortcutKey}</span>
              </button>
              {StylePicker && (
                <AnchoredOverlay
                  open={dragArmed}
                  // Deliberately NOT wired to disarm: AnchoredOverlay is
                  // fully controlled by `open` (verified against its own
                  // source -- onClickOutside/onEscape only ever CALL
                  // onClose, they never close anything themselves), so
                  // leaving this a no-op means clicking the canvas to
                  // start a drag -- itself an "outside click" against
                  // this popover -- never disarms the tool mid-gesture.
                  // Only the tray button, Escape, or picking another
                  // tool changes armedTool, all already wired elsewhere.
                  onClose={() => {}}
                  anchorRef={anchorRefs[tool.id]}
                  renderAnchor={null}
                  side="outside-top"
                >
                  <StylePicker />
                </AnchoredOverlay>
              )}
            </Fragment>
          )
        }
        if (tool.interaction === 'paste-or-drop') {
          return (
            <Fragment key={tool.id}>
              <button
                ref={anchorRefs[tool.id]}
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
                anchorRef={anchorRefs[tool.id]}
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
