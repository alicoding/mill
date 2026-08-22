import { Fragment, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { AnchoredOverlay, Button } from '@primer/react'
import { AtlasTableSizePicker } from './AtlasTableSizePicker'
import { ATLAS_TOOLS, type AtlasCreationTool } from './atlasTools'
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
// 0169 slice 1) -- Card/Note/Area arm a placement on click
// ('arm-then-click'); Table opens its size picker anchored to its own
// button instead ('pick-then-place'), with "From a List…" in the
// picker's footer as the projection door. Hidden entirely below the
// companion breakpoint -- the caller (AtlasBoard) only renders this
// when !readOnly.
export function AtlasCreationTray({ armedTool, onToggle, tablePickerOpen, onTableToggle, onPickTableSize, onTableFromList }: {
  armedTool: AtlasCreationTool | null
  onToggle: (tool: AtlasCreationTool) => void
  tablePickerOpen: boolean
  onTableToggle: (open: boolean) => void
  onPickTableSize: (cols: number, rows: number) => void
  onTableFromList: () => void
}) {
  const { t } = useTranslation('atlas')
  const tools = ATLAS_TOOLS.filter((tool) => tool.tray === 'quick')
  const tableButtonRef = useRef<HTMLButtonElement>(null)

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
                onClick={() => onTableToggle(!tablePickerOpen)}
              >
                <Icon size={14} />
                <span className={styles.label}>{t(`creationTray.${tool.id}Label`)}</span>
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
        const armed = armedTool === tool.id
        // A drag-from-tray placement lands via a single drop point
        // (creation.placeAt's own guard skips 'area' outright, since
        // its placement is a drawn rectangle, not a click point) -- so
        // Area alone carries no drag source, exactly as before this
        // registry existed.
        const draggable = tool.id !== 'area'
        return (
          <button
            key={tool.id}
            type="button"
            className={styles.tool}
            data-testid={`atlas-tray-${tool.id}`}
            data-armed={armed}
            aria-pressed={armed}
            title={t(`creationTray.${tool.id}Tooltip`)}
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
            <span className={styles.label}>{t(`creationTray.${tool.id}Label`)}</span>
            <span className={styles.kbd}>{tool.shortcutKey}</span>
          </button>
        )
      })}
    </div>
  )
}
