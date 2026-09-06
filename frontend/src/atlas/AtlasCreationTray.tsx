import { useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@primer/react'
import { ImageIcon, PaintbrushIcon, PlusIcon } from '@primer/octicons-react'
import { runCommand } from '../shared/commands'
import { useExtensionEnablementStore } from '../shared/extensionEnablementStore'
import { ATLAS_TOOLS, type AtlasArmableTool, type AtlasToolID, type AtlasToolShape } from './atlasTools'
import { AtlasMorePanel } from './AtlasMorePanel'
import { AtlasTrayFlyout } from './AtlasTrayFlyout'
import { AtlasTrayToolButton, armTool, type AtlasTrayToolHandlers } from './AtlasTrayToolButton'
import { placeDockTools, pushRecentTool, readRecentTools, writeRecentTools } from './atlasToolPlacement'
import styles from './AtlasCreationTray.module.css'

export { ATLAS_TOOL_DRAG_MIME } from './atlasTrayDrag'

// The board's creation dock (goal 0355). Seven buttons, always the same
// seven, in the same order: Card, Note, Area, Table, Media, Annotate,
// More. The dock does NOT grow when a tool is installed -- that is the
// whole point of the shape. A tool with no button of its own is found
// by name in the More panel, which reads the registry, so an extension
// installed a year from now is reachable with no change here.
//
// WHERE each tool goes is atlasToolPlacement.ts's one answer; WHAT a
// button looks like and does is AtlasTrayToolButton.tsx's; this file
// owns only the slots and which single overlay is open.
//
// THE ONE-OVERLAY INVARIANT (verified live, not a guess): Primer's
// AnchoredOverlay machinery breaks React Flow's Space-to-pan the
// instant a SECOND instance is simultaneously open -- a rebuild with
// both focusTrapSettings and focusZoneSettings disabled still
// reproduced it, and unmounting the second overlay was the only change
// that fixed it. So the dock resolves ONE `overlay` value per render
// and nothing else may mount one: opening a flyout or the More panel
// withholds every tool's own popover, and arming a tool inside a flyout
// closes that flyout and gives the tool's own button the slot instead.
// The consequence: switching between two tools of the same flyout means
// disarming first (Escape, or re-clicking) and reopening -- a real
// behavior change from "every button always visible", and the point of
// the dock, not a defect.
//
// Icon + shortcut chip only, no visible text label (goal 0169 slice 4's
// finding): a text label per button made the dock's WIDTH grow with
// every tool the registry gained. The full name stays discoverable via
// `title` (hover) and `aria-label` (screen readers) on every button,
// flyout triggers included.

// Which overlay owns the single slot this render.
type TrayOverlay = 'more' | 'media' | 'annotate' | 'tool'

export function AtlasCreationTray({ armedTool, locked, onToggle, tablePickerOpen, onTableToggle, onClosePickerVisibility, onPickTableSize, onTableFromList, imagePopoverOpen, onImageToggle, onImageSubmitPath, onImageSubmitFile, onImageSubmitText }: {
  // The ONE shared armed-tool field (useAtlasArmedTool.ts, goal 0238)
  // -- Table/Image share the exact same value every other tool's own
  // `data-armed`/`aria-pressed` derives from, so two dock buttons can
  // never show armed at once.
  armedTool: AtlasToolID | null
  // Whether the CURRENTLY armed tool is locked (goal 0199 part D) --
  // only ever meaningful together with armedTool.
  locked: boolean
  onToggle: (tool: AtlasArmableTool) => void
  // Table's own size-picker POPOVER visibility -- narrower than
  // armedness (armedTool === 'table' stays true through the
  // placement-pending phase after a size is picked).
  tablePickerOpen: boolean
  onTableToggle: (open: boolean) => void
  // Closes the popover's own visibility WITHOUT disarming (see
  // useTablePickerSignal.ts's own header comment for why this stays a
  // dedicated call rather than a side effect of picking a size).
  onClosePickerVisibility: () => void
  onPickTableSize: (cols: number, rows: number) => void
  onTableFromList: () => void
  imagePopoverOpen: boolean
  onImageToggle: (open: boolean) => void
  onImageSubmitPath: (path: string) => Promise<void>
  onImageSubmitFile: (file: File) => Promise<void>
  onImageSubmitText: (text: string) => Promise<void>
}) {
  const { t } = useTranslation('atlas')
  // Settings > Extensions disable semantics, item 1: a disabled tool's
  // own button is removed entirely (never shown dimmed) -- subscribed
  // live so a toggle flipped in Settings updates an already-open board
  // without a reload.
  const disabledExtensionIds = useExtensionEnablementStore((s) => s.disabledExtensionIds)
  const tools = ATLAS_TOOLS.filter((tool) => tool.tray === 'quick' && !disabledExtensionIds.includes(tool.id))
  const placement = placeDockTools(tools)

  // A tool's own anchor ref belongs to its own button
  // (AtlasTrayToolButton.tsx), never a map held here: one ref object
  // shared across mapped buttons would make two AnchoredOverlays anchor
  // to whichever DOM node happened to render last. Only the three slots
  // this file renders directly keep a ref of their own.
  const mediaAnchorRef = useRef<HTMLButtonElement>(null)
  const annotateAnchorRef = useRef<HTMLButtonElement>(null)
  const moreAnchorRef = useRef<HTMLButtonElement>(null)

  const [mediaOpen, setMediaOpen] = useState(false)
  const [annotateOpen, setAnnotateOpen] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const [recentIDs, setRecentIDs] = useState<string[]>(readRecentTools)

  const handlers: AtlasTrayToolHandlers = {
    onToggle, tablePickerOpen, onTableToggle, onClosePickerVisibility, onPickTableSize, onTableFromList,
    imagePopoverOpen, onImageToggle, onImageSubmitPath, onImageSubmitFile, onImageSubmitText,
  }

  // A flyout's slot belongs to whichever of its tools is armed right
  // now: that tool's own button (and its own popover) takes the slot,
  // and the generic trigger is absent until it disarms.
  const mediaArmed = placement.media.find((tool) => (
    tool.interaction === 'paste-or-drop' ? imagePopoverOpen : tool.id === armedTool
  ))
  const annotateArmed = placement.annotate.find((tool) => tool.id === armedTool)
  // The More slot follows the same rule its two flyout neighbours do: a
  // tool armed from the panel has no button anywhere else, so the slot
  // becomes that tool's own button -- its letter chip, its lock state
  // and its style picker all appear where the "+" was, and the "+"
  // comes back the moment it disarms. Without this a panel-armed tool
  // would be armed with nothing on screen saying so.
  const dockedIDs = new Set([...placement.objects, ...placement.media, ...placement.annotate].map((tool) => tool.id as string))
  const panelArmed = armedTool !== null && !dockedIDs.has(armedTool)
    ? placement.panel.find((tool) => tool.id === armedTool)
    : undefined

  // Exactly one overlay, resolved once. Order is precedence: a panel
  // the person just opened outranks a popover that was already there.
  const overlay: TrayOverlay = moreOpen ? 'more' : mediaOpen ? 'media' : annotateOpen ? 'annotate' : 'tool'

  // Browsing served its purpose the instant a tool arms, so a flyout
  // collapses rather than staying open uninvited behind the armed tool.
  const anyArmed = mediaArmed !== undefined || annotateArmed !== undefined || panelArmed !== undefined
  const wasArmed = useRef(anyArmed)
  useLayoutEffect(() => {
    if (!wasArmed.current && anyArmed) { setMediaOpen(false); setAnnotateOpen(false); setMoreOpen(false) }
    wasArmed.current = anyArmed
  }, [anyArmed])

  const rememberTool = (id: string) => {
    setRecentIDs((prev) => {
      const next = pushRecentTool(prev, id)
      writeRecentTools(next)
      return next
    })
  }

  // The one door every non-dock surface arms through (a flyout entry, a
  // More panel row, a recents chip): the same call the dock button
  // makes, plus the recents record.
  const pickTool = (tool: AtlasToolShape) => {
    setMediaOpen(false)
    setAnnotateOpen(false)
    rememberTool(tool.id)
    armTool(tool, handlers, false)
  }

  // Opening a flyout or the panel first closes whatever popover was
  // floating in the same slot -- traced live: the image paste zone
  // stayed open and intercepted the pointer meant for a button inside
  // the flyout, deadlocking the re-arm.
  const closeFloatingPopovers = () => {
    if (tablePickerOpen) onTableToggle(false)
    if (imagePopoverOpen) onImageToggle(false)
  }

  const renderTool = (tool: AtlasToolShape) => (
    <AtlasTrayToolButton
      key={tool.id}
      tool={tool}
      armedTool={armedTool}
      locked={locked}
      withOverlay={overlay === 'tool'}
      handlers={handlers}
    />
  )

  return (
    <div className={styles.tray} data-testid="atlas-creation-tray" role="toolbar" aria-label={t('creationTray.ariaLabel')}>
      {placement.objects.map(renderTool)}
      {placement.media.length === 0 ? null : mediaArmed ? renderTool(mediaArmed) : (
        <AtlasTrayFlyout
          testid="atlas-tray-media-group"
          anchorRef={mediaAnchorRef}
          fallbackIcon={ImageIcon}
          members={placement.media}
          chip={placement.media[0]?.shortcutKey ?? null}
          labelKey="creationTray.mediaLabel"
          tooltipKey="creationTray.mediaTooltip"
          open={mediaOpen}
          onOpenChange={(open) => { closeFloatingPopovers(); setMediaOpen(open) }}
          onPickTool={pickTool}
          // A file already on disk is the other half of this slot, and
          // it lands through the same routing a dropped file takes
          // (useAtlasPickBoardFile.ts).
          footer={(
            <div className={styles.pickerFooter}>
              <Button size="small" variant="invisible" data-testid="atlas-tray-from-file" onClick={() => { setMediaOpen(false); void runCommand('atlas.addFile') }}>
                {t('creationTray.fromFile')}
              </Button>
            </div>
          )}
        />
      )}
      {placement.annotate.length === 0 ? null : annotateArmed ? renderTool(annotateArmed) : (
        <AtlasTrayFlyout
          testid="atlas-tray-annotate-group"
          anchorRef={annotateAnchorRef}
          fallbackIcon={PaintbrushIcon}
          members={placement.annotate}
          chip={null}
          labelKey="creationTray.annotateLabel"
          tooltipKey="creationTray.annotateTooltip"
          open={annotateOpen}
          onOpenChange={(open) => { closeFloatingPopovers(); setAnnotateOpen(open) }}
          onPickTool={pickTool}
        />
      )}
      {panelArmed ? renderTool(panelArmed) : (
        <button
          ref={moreAnchorRef}
          type="button"
          className={styles.tool}
          data-testid="atlas-tray-more"
          data-armed={false}
          aria-expanded={moreOpen}
          aria-haspopup="true"
          title={t('morePanel.trigger')}
          aria-label={t('morePanel.trigger')}
          onClick={() => { closeFloatingPopovers(); setMediaOpen(false); setAnnotateOpen(false); setMoreOpen((open) => !open) }}
        >
          <PlusIcon size={14} />
        </button>
      )}
      {overlay === 'more' && (
        <AtlasMorePanel
          open={moreOpen}
          onClose={() => setMoreOpen(false)}
          anchorRef={moreAnchorRef}
          tools={placement.panel}
          recentIDs={recentIDs}
          onPickTool={pickTool}
        />
      )}
    </div>
  )
}
