import type { ReactNode, RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import { AnchoredOverlay } from '@primer/react'
import { ChevronDownIcon } from '@primer/octicons-react'
import type { Icon } from '@primer/octicons-react'
import type { AtlasToolShape } from './atlasTools'
import styles from './AtlasCreationTray.module.css'

// One dock slot that holds a family of tools (goal 0355): its trigger,
// and the single overlay listing what it holds. Media and Annotate are
// the same component with different members, so a tool inside either
// one reads and behaves identically.
//
// The face glyph comes from the first ENABLED member rather than a
// hardcoded icon, so disabling that member never leaves a glyph for a
// tool the flyout no longer holds; `fallbackIcon` covers "every member
// disabled", where the slot would have nothing to show anyway.
export function AtlasTrayFlyout({ testid, anchorRef, fallbackIcon, members, chip, labelKey, tooltipKey, open, onOpenChange, onPickTool, footer }: {
  testid: string
  anchorRef: RefObject<HTMLButtonElement | null>
  fallbackIcon: Icon
  members: AtlasToolShape[]
  // The letter chip the trigger shows -- the family's own primary key
  // (Media shows Image's "I"), or null where the members share no one
  // key a chip could honestly claim.
  chip: string | null
  labelKey: string
  tooltipKey: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onPickTool: (tool: AtlasToolShape) => void
  footer?: ReactNode
}) {
  const { t } = useTranslation('atlas')
  const FaceIcon = members[0]?.icon ?? fallbackIcon
  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        className={styles.tool}
        data-testid={testid}
        data-armed={false}
        aria-expanded={open}
        aria-haspopup="true"
        title={t(tooltipKey)}
        aria-label={t(labelKey)}
        onClick={() => onOpenChange(!open)}
      >
        <FaceIcon size={14} />
        {chip && <span className={styles.kbd}>{chip}</span>}
        <ChevronDownIcon size={12} />
      </button>
      <AnchoredOverlay
        open={open}
        onClose={() => onOpenChange(false)}
        // Disabled for the reason AtlasCreationTray.tsx's header states:
        // even a transient overlap between this flyout unmounting and an
        // armed tool's own style panel mounting reproduces the
        // Space-to-pan regression, and a flat row of independent buttons
        // needs neither a trap nor a zone.
        focusTrapSettings={{ disabled: true }}
        focusZoneSettings={{ disabled: true }}
        anchorRef={anchorRef}
        renderAnchor={null}
        side="outside-top"
      >
        <div className={styles.toolFlyout} role="group" aria-label={t(labelKey)}>
          {members.map((tool) => (
            <button
              key={tool.id}
              type="button"
              className={styles.tool}
              data-testid={`atlas-tray-${tool.id}`}
              data-armed={false}
              title={t(`creationTray.${tool.id}Tooltip`, { defaultValue: tool.nounName })}
              aria-label={t(`creationTray.${tool.id}Label`, { defaultValue: tool.nounName })}
              onClick={() => onPickTool(tool)}
            >
              <tool.icon size={14} />
              {tool.shortcutKey && <span className={styles.kbd}>{tool.shortcutKey}</span>}
            </button>
          ))}
        </div>
        {footer}
      </AnchoredOverlay>
    </>
  )
}
