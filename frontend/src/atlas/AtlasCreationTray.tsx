import { useTranslation } from 'react-i18next'
import { FileIcon, NoteIcon, SquareIcon } from '@primer/octicons-react'
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

// The floating creation tray (goal 0081's LOCKED design, section 2):
// bottom-center of the map, three tools (Card/Note/Area). A click
// toggles arming (clicking the already-armed tool disarms it, matching
// Esc and a canvas placement); dragging Card/Note onto the canvas
// places at the drop point via the same ATLAS_TOOL_DRAG_MIME payload
// AtlasBoard's onDrop reads -- Area is click-to-arm only (not
// draggable), since its own placement is a drawn rectangle. Hidden
// entirely below the companion breakpoint -- the caller (AtlasBoard)
// only renders this when !readOnly, so no internal breakpoint check here.
export function AtlasCreationTray({ armedTool, onToggle }: {
  armedTool: AtlasCreationTool | null
  onToggle: (tool: AtlasCreationTool) => void
}) {
  const { t } = useTranslation('atlas')
  const tools: AtlasCreationTool[] = ['card', 'note', 'area']

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
    </div>
  )
}
