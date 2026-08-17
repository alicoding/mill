import { useTranslation } from 'react-i18next'
import { FileIcon, NoteIcon } from '@primer/octicons-react'
import styles from './AtlasCreationTray.module.css'

export type AtlasCreationTool = 'card' | 'note'

// The drag payload's own MIME key (goal 0081 slice A1) -- shared by
// this tray's onDragStart and AtlasBoard's own onDrop handler so a
// drag-from-tray placement and a click-to-arm placement land through
// the exact same "what tool, what point" contract.
export const ATLAS_TOOL_DRAG_MIME = 'application/x-mill-atlas-tool'

const TOOL_ICON: Record<AtlasCreationTool, typeof FileIcon> = { card: FileIcon, note: NoteIcon }
const TOOL_KEY: Record<AtlasCreationTool, string> = { card: 'C', note: 'N' }

// The floating creation tray (goal 0081 slice A1's LOCKED design,
// section 2): bottom-center of the map, two tools in this slice (Card/
// Note -- Area is slice A2). A click toggles arming (clicking the
// already-armed tool disarms it, matching Esc and a canvas
// placement); dragging a tool onto the canvas places at the drop point
// via the same ATLAS_TOOL_DRAG_MIME payload AtlasBoard's onDrop reads.
// Hidden entirely below the companion breakpoint -- the caller (AtlasBoard)
// only renders this when !readOnly, so no internal breakpoint check here.
export function AtlasCreationTray({ armedTool, onToggle }: {
  armedTool: AtlasCreationTool | null
  onToggle: (tool: AtlasCreationTool) => void
}) {
  const { t } = useTranslation('atlas')
  const tools: AtlasCreationTool[] = ['card', 'note']

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
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData(ATLAS_TOOL_DRAG_MIME, tool)
              e.dataTransfer.effectAllowed = 'copy'
            }}
            onClick={() => onToggle(tool)}
          >
            <Icon size={14} />
            <span className={styles.label}>{t(`creationTray.${tool}Label`)}</span>
            <span className={styles.kbd}>{TOOL_KEY[tool]}</span>
          </button>
        )
      })}
    </div>
  )
}
