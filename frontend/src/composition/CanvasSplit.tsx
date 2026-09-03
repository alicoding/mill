import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { IconButton } from '@primer/react'
import { SidebarCollapseIcon, SidebarExpandIcon } from '@primer/octicons-react'
import { Group, Panel, Separator, useDefaultLayout, usePanelRef } from 'react-resizable-panels'
import styles from './CanvasSplit.module.css'

// The canvas | inspector split (goal 0304). The adopted panel library
// owns the whole resize contract -- pointer drag, arrow keys on the
// separator, double-click to reset, min/max clamping; Mill owns only
// the seam: the inspector opens with a selection and collapses
// without one, its default and bounds, and where a chosen width
// persists (this device's storage -- a layout size is per-device
// state, never a synced preference).
const INSPECTOR_DEFAULT_SIZE = '280px'
const INSPECTOR_MIN_SIZE = '220px'
const INSPECTOR_MAX_SIZE = '60%'
const CANVAS_MIN_SIZE = '30%'
export const INSPECTOR_LAYOUT_ID = 'composition-inspector'

function deviceStorage(): Pick<Storage, 'getItem' | 'setItem'> {
  try {
    return window.localStorage
  } catch {
    return { getItem: () => null, setItem: () => undefined }
  }
}

export function CanvasSplit({ hasSelection, canvas, inspector }: { hasSelection: boolean; canvas: ReactNode; inspector: (headerActions: ReactNode) => ReactNode }) {
  const { t } = useTranslation('composition')
  const panelRef = usePanelRef()
  // Only a user's own drag is worth remembering across sessions.
  const layout = useDefaultLayout({ id: INSPECTOR_LAYOUT_ID, storage: deviceStorage(), onlySaveAfterUserInteractions: true })
  // The inspector panel and its separator mount only while something is
  // selected (the library's imperative collapse clamps to the pixel
  // minimum); the width it last had is what it reopens at.
  const liveWidth = useRef<number | null>(null)
  const [lastOpenWidth, setLastOpenWidth] = useState<number | null>(null)
  useEffect(() => {
    // Record the width when the inspector closes -- never during a drag,
    // where a changing default would feed back into the gesture.
    if (!hasSelection && liveWidth.current) setLastOpenWidth(liveWidth.current)
  }, [hasSelection])
  // Expand widens the inspector to its ceiling and Shrink returns it to
  // the width it had -- the editor-panel maximize convention. Inline
  // like the canvas toolbar's own actions; it becomes a registry command
  // when that toolbar's set migrates together (goal 0304's record).
  const [expanded, setExpanded] = useState(false)
  const widthBeforeExpand = useRef<number | null>(null)
  const toggleExpanded = () => {
    const handle = panelRef.current
    if (!handle) return
    if (expanded) {
      handle.resize(widthBeforeExpand.current ?? INSPECTOR_DEFAULT_SIZE)
      setExpanded(false)
    } else {
      widthBeforeExpand.current = handle.getSize().inPixels
      handle.resize(INSPECTOR_MAX_SIZE)
      setExpanded(true)
    }
  }
  return (
    <Group orientation="horizontal" className={styles.group} defaultLayout={layout.defaultLayout} onLayoutChange={layout.onLayoutChange} onLayoutChanged={layout.onLayoutChanged}>
      <Panel id="canvas" minSize={CANVAS_MIN_SIZE} className={styles.canvasPanel}>
        {canvas}
      </Panel>
      {hasSelection && (
        <>
          <Separator className={styles.separator} aria-label={t('compositionCanvas.resizeInspector')} />
          <Panel
            id="inspector"
            panelRef={panelRef}
            defaultSize={lastOpenWidth ?? INSPECTOR_DEFAULT_SIZE}
            minSize={INSPECTOR_MIN_SIZE}
            maxSize={INSPECTOR_MAX_SIZE}
            className={styles.inspectorPanel}
            onResize={(size) => { if (size.inPixels > 0) liveWidth.current = size.inPixels }}
          >
            {inspector(
              <IconButton
                icon={expanded ? SidebarExpandIcon : SidebarCollapseIcon}
                size="small"
                variant="invisible"
                aria-label={expanded ? t('compositionCanvas.shrinkInspector') : t('compositionCanvas.expandInspector')}
                aria-pressed={expanded}
                onClick={toggleExpanded}
                data-testid="composition-inspector-expand"
              />,
            )}
          </Panel>
        </>
      )}
    </Group>
  )
}
