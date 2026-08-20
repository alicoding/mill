import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { AnchoredOverlay, Button } from '@primer/react'
import { FileIcon, NoteIcon, SquareIcon, TableIcon } from '@primer/octicons-react'
import { AtlasTableSizePicker } from './AtlasTableSizePicker'
import styles from './AtlasCreationTray.module.css'

export type AtlasCreationTool = 'card' | 'note' | 'area'

// The drag payload's own MIME key (goal 0081 slice A1) -- shared by
// this tray's onDragStart and AtlasBoard's own onDrop handler so a
// drag-from-tray placement and a click-to-arm placement land through
// the exact same "what tool, what point" contract. Area (slice A2)
// arms via click/bare-key like Card/Note, but its own placement is a
// drag-drawn rectangle, not a single drop point -- it carries no
// ATLAS_TOOL_DRAG_MIME payload of its own.
export const ATLAS_TOOL_DRAG_MIME = 'application/x-mill-atlas-tool'

const TOOL_ICON: Record<AtlasCreationTool, typeof FileIcon> = { card: FileIcon, note: NoteIcon, area: SquareIcon }
const TOOL_KEY: Record<AtlasCreationTool, string> = { card: 'C', note: 'N', area: 'A' }

// The creation toolbar (goal 0081's LOCKED design, section 2; goal
// 0139 made it THE creation surface -- every creatable thing is a
// visible tool here, nothing behind a dropdown). Card/Note/Area arm a
// placement; Table opens the size picker anchored to its own button
// (the picker's click IS the creation, no placement step), with
// "From a List…" in the picker's footer as the projection door.
// Hidden entirely below the companion breakpoint -- the caller
// (AtlasBoard) only renders this when !readOnly.
export function AtlasCreationTray({ armedTool, onToggle, tablePickerOpen, onTableToggle, onPickTableSize, onTableFromList }: {
  armedTool: AtlasCreationTool | null
  onToggle: (tool: AtlasCreationTool) => void
  tablePickerOpen: boolean
  onTableToggle: (open: boolean) => void
  onPickTableSize: (cols: number, rows: number) => void
  onTableFromList: () => void
}) {
  const { t } = useTranslation('atlas')
  const tools: AtlasCreationTool[] = ['card', 'note', 'area']
  const tableButtonRef = useRef<HTMLButtonElement>(null)

  return (
    <div className={styles.tray} data-testid="atlas-creation-tray" role="toolbar" aria-label={t('creationTray.ariaLabel')}>
      {tools.map((tool) => {
        const Icon = TOOL_ICON[tool]
        const armed = armedTool === tool
        return (
          <button
            key={tool}
            type="button"
            className={styles.tool}
            data-testid={`atlas-tray-${tool}`}
            data-armed={armed}
            aria-pressed={armed}
            title={t(`creationTray.${tool}Tooltip`)}
            draggable={tool !== 'area'}
            onDragStart={
              tool === 'area'
                ? undefined
                : (e) => {
                    e.dataTransfer.setData(ATLAS_TOOL_DRAG_MIME, tool)
                    e.dataTransfer.effectAllowed = 'copy'
                  }
            }
            onClick={() => onToggle(tool)}
          >
            <Icon size={14} />
            <span className={styles.label}>{t(`creationTray.${tool}Label`)}</span>
            <span className={styles.kbd}>{TOOL_KEY[tool]}</span>
          </button>
        )
      })}
      <button
        ref={tableButtonRef}
        type="button"
        className={styles.tool}
        data-testid="atlas-tray-table"
        data-armed={tablePickerOpen}
        aria-pressed={tablePickerOpen}
        title={t('creationTray.tableTooltip')}
        onClick={() => onTableToggle(!tablePickerOpen)}
      >
        <TableIcon size={14} />
        <span className={styles.label}>{t('creationTray.tableLabel')}</span>
        <span className={styles.kbd}>T</span>
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
    </div>
  )
}
