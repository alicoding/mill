import { createRef, Fragment, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { copy } from '../shared/copy'
import type { RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import { AnchoredOverlay, Button } from '@primer/react'
import { LockIcon, PaintbrushIcon, ChevronDownIcon } from '@primer/octicons-react'
import { AtlasTableSizePicker } from './AtlasTableSizePicker'
import { AtlasImageInput } from './AtlasImageInput'
import { AtlasStylePanel } from './AtlasStylePanel'
import { ATLAS_TOOLS, type AtlasArmableTool, type AtlasToolID, type AtlasToolShape } from './atlasTools'
import { useExtensionEnablementStore } from '../shared/extensionEnablementStore'
import styles from './AtlasCreationTray.module.css'

// The drag payload's own MIME key (goal 0081 slice A1) -- shared by
// this tray's onDragStart and AtlasBoard's own onDrop handler so a
// drag-from-tray placement and a click-to-arm placement land through
// the exact same "what tool, what point" contract. Area (slice A2)
// arms via click/bare-key like Card/Note, but its own placement is a
// drag-drawn rectangle, not a single drop point -- it carries no
// ATLAS_TOOL_DRAG_MIME payload of its own.
export const ATLAS_TOOL_DRAG_MIME = 'application/x-mill-atlas-tool'

// The tray's own render order (goal 0224's tray-restructure slice --
// "I don't want to give the impression I'm draw.io"): every tool
// declares its own `group` (atlasNounRegistry.ts); this is the ONE
// place that maps those declared groups onto tray position, so
// re-ordering the clusters is a one-line edit here, never a
// hand-enumerated JSX reshuffle. 'annotate' is deliberately excluded --
// it never renders flat, only inside the collapsed Annotate group
// below.
const PRIMARY_GROUP_ORDER = ['knowledge', 'file'] as const

// The creation toolbar (goal 0081's LOCKED design, section 2; goal
// 0139 made it THE creation surface -- every creatable thing is a
// visible tool here, nothing behind a dropdown). Every tool in the
// registry's own 'quick' tray renders through renderToolButton below
// (goal 0169 slices 1-4) -- Card/Note arm a placement on click
// ('arm-then-click'); Table opens its size picker anchored to its own
// button instead ('pick-then-place'), with "From a List…" in the
// picker's footer as the projection door; Image opens its own path/
// paste popover the same anchored way ('paste-or-drop'); Pencil arms
// on click too, but STAYS armed across strokes (its own gesture engine
// hook, useAtlasToolGesture.ts, owns completion, never disarming
// itself), with its own colour/size options bar shown anchored for as
// long as it's the armed tool ('drag-to-draw'); Shape and Area
// (reclassified goal 0215 S2 -- its own runtime gesture was always a
// marquee drag) share that same interaction and branch, each one's own
// options bar (Area has none: an empty styleFields) rendered from its
// own styleFields declaration (goal 0209) rather than a second branch.
// An ephemeral drag tool falls through to the same plain arm-on-click
// button the default branch already renders for Card/Note -- it needs
// no options popover, so no branch of its own; only its declared drag
// gesture differs.
//
// Knowledge/File render flat and primary (Card, Note, Table, Area, then
// Image); the freehand-marking family -- the Drawing plugin's
// shape/pencil/eraser/laser, and any other tool declaring group
// 'annotate' -- collapses into one "Annotate" disclosure group (goal
// 0224's disposition table: native shapes/pencil/eraser/laser on a flat
// toolbar are the "we're draw.io" signal). Nothing is REMOVED -- every
// tool renders through the exact same renderToolButton function either
// way, so arming/locking/style-panel behaviour is unchanged; only WHERE
// its button lives differs. Hidden entirely below the companion
// breakpoint -- the caller (AtlasBoard) only renders this when
// !readOnly.
//
// Icon + shortcut-chip only, no visible text label (goal 0169 slice 4
// finding): a text label per button made the tray's own WIDTH grow
// unboundedly with every tool this registry gains -- confirmed live
// when the 8th button (Laser) widened the tray enough to push its
// LEFT edge over a fixed test coordinate an unrelated spec clicked
// near the board's bottom-left. The full name is still discoverable
// via `title` (hover) and `aria-label` (screen readers) on every
// button, including the Annotate group's own trigger.
export function AtlasCreationTray({ armedTool, locked, onToggle, tablePickerOpen, onTableToggle, onClosePickerVisibility, onPickTableSize, onTableFromList, imagePopoverOpen, onImageToggle, onImageSubmitPath, onImageSubmitFile, onImageSubmitText }: {
  // The ONE shared armed-tool field (useAtlasArmedTool.ts, goal 0238)
  // -- widened past AtlasArmableTool so Table/Image share the exact
  // same value every OTHER tool's own `data-armed`/`aria-pressed`
  // already derived from, instead of the two popover-only booleans
  // this component used to read for those two branches alone (the bug
  // this goal fixes: those booleans never disarmed when a DIFFERENT
  // tool armed, so two tray buttons could show armed at once).
  armedTool: AtlasToolID | null
  // Whether the CURRENTLY armed tool is locked (goal 0199 part D) --
  // only ever meaningful together with armedTool, so this is a single
  // flag rather than a second id to keep in sync with the first.
  locked: boolean
  onToggle: (tool: AtlasArmableTool) => void
  // Table's own size-picker POPOVER visibility -- narrower than
  // armedness (armedTool === 'table' stays true through the
  // placement-pending phase after a size is picked, but the popover
  // itself has nothing left to show by then).
  tablePickerOpen: boolean
  onTableToggle: (open: boolean) => void
  // Closes the popover's own visibility WITHOUT disarming (see
  // useTablePickerSignal.ts's own header comment for why this stays a
  // dedicated call, called in the same handler as onPickTableSize,
  // rather than a side effect derived from picking a size).
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
  // own button is removed from the tray entirely (never shown
  // dimmed/disabled) -- subscribed live so a toggle flipped in Settings
  // updates an already-open board without a reload.
  const disabledExtensionIds = useExtensionEnablementStore((s) => s.disabledExtensionIds)
  const tools = ATLAS_TOOLS.filter((tool) => tool.tray === 'quick' && !disabledExtensionIds.includes(tool.id))
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
  const primaryTools = PRIMARY_GROUP_ORDER.flatMap((group) => tools.filter((tool) => tool.group === group))
  const annotateTools = tools.filter((tool) => tool.group === 'annotate')
  // The collapsed group trigger's own face glyph (goal 0237 S3's review
  // rider): derived from the first ENABLED annotate tool rather than a
  // hardcoded icon, so disabling that tool from Settings > Extensions
  // never leaves the trigger showing a glyph for a tool that's no
  // longer in the group at all. Falls back to the generic paintbrush
  // only when every annotate tool is disabled and the drawer would
  // have nothing left to show anyway.
  const AnnotateGroupIcon = annotateTools[0]?.icon ?? PaintbrushIcon
  const annotateGroupAnchorRef = useRef<HTMLButtonElement>(null)
  // The Annotate group's own disclosure state (goal 0224). At most ONE
  // AnchoredOverlay for the whole annotate family is ever mounted at a
  // time -- verified live (not a guess) that Primer's own AnchoredOverlay
  // machinery breaks React Flow's Space-to-pan the instant a SECOND
  // instance is simultaneously open (the drawer's own popover nested
  // around an armed tool's own style-panel popover): a rebuild with
  // BOTH focusTrapSettings and focusZoneSettings disabled still
  // reproduced it, and removing the drawer from the tree the moment a
  // tool arms was the only change that actually fixed it -- so the
  // fix is structural (never nest two), not a focus-machinery tweak.
  //
  // The consequence this shapes: once a tool arms, this component STOPS
  // rendering the drawer/trigger pairing entirely and renders that
  // tool's OWN flat button (+ its own style panel, if it has one) in
  // the SAME tray slot instead -- exactly the same renderToolButton
  // path a primary tool already goes through, so its own single
  // AnchoredOverlay is the only one mounted for the family. Switching
  // to a DIFFERENT annotate tool while one is armed means disarming
  // first (Escape, or re-clicking it) and reopening the drawer -- a
  // real behavior change from "every button always visible," but the
  // whole point of this collapse; not a defect.
  //
  // manualOpen means "the drawer is open for browsing" and resets
  // to false the instant a tool ARMS (browsing served its purpose), so
  // the drawer starts collapsed again -- not re-opened uninvited -- the
  // next time nothing is armed.
  const [manualOpen, setManualOpen] = useState(false)
  const annotateArmedTool = annotateTools.find((tool) => tool.id === armedTool)
  const annotateArmed = annotateArmedTool !== undefined
  const wasAnnotateArmed = useRef(annotateArmed)
  useLayoutEffect(() => {
    if (!wasAnnotateArmed.current && annotateArmed) setManualOpen(false)
    wasAnnotateArmed.current = annotateArmed
  }, [annotateArmed])

  const renderToolButton = (tool: AtlasToolShape) => {
    const Icon = tool.icon
    if (tool.interaction === 'pick-then-place') {
      const tableArmed = armedTool === tool.id
      return (
        <Fragment key={tool.id}>
          <button
            ref={anchorRefs[tool.id]}
            type="button"
            className={styles.tool}
            data-testid={`atlas-tray-${tool.id}`}
            data-armed={tableArmed}
            aria-pressed={tableArmed}
            title={t(`creationTray.${tool.id}Tooltip`, { defaultValue: copy(tool.description ?? tool.label) })}
            aria-label={t(`creationTray.${tool.id}Label`, { defaultValue: copy(tool.label) })}
            onClick={() => onTableToggle(!tableArmed)}
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
            {/* Picking a size stays armed for the click-to-place
                phase (useTablePickerSignal.ts) -- closes only the
                popover's own visibility, never disarms. */}
            <AtlasTableSizePicker onPick={(cols, rows) => { onClosePickerVisibility(); onPickTableSize(cols, rows) }} />
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
      // Locked reads only off the CURRENTLY armed tool (goal 0199
      // part D) -- a stale `locked` from a since-disarmed tool
      // must never paint a different button.
      const isLocked = dragArmed && locked
      // Whether an options-bar panel floats above the button (goal
      // 0169 slice 5, re-platformed goal 0209): registry-driven off
      // the tool's OWN styleFields declaration (atlasNounRegistry.ts)
      // rather than a branch naming pencil/shape here -- a THIRD
      // drag-to-draw tool costs this branch nothing.
      const hasStyleFields = tool.styleFields.length > 0
      return (
        <Fragment key={tool.id}>
          <button
            ref={anchorRefs[tool.id]}
            type="button"
            className={styles.tool}
            data-testid={`atlas-tray-${tool.id}`}
            data-armed={dragArmed}
            data-locked={isLocked}
            aria-pressed={dragArmed}
            title={isLocked ? t('creationTray.lockedTooltip', { tool: t(`creationTray.${tool.id}Label`, { defaultValue: copy(tool.label) }) }) : t(`creationTray.${tool.id}Tooltip`, { defaultValue: copy(tool.description ?? tool.label) })}
            aria-label={t(`creationTray.${tool.id}Label`, { defaultValue: copy(tool.label) })}
            onClick={() => onToggle(tool.id)}
          >
            {isLocked ? <LockIcon size={14} /> : <Icon size={14} />}
            <span className={styles.kbd}>{tool.shortcutKey}</span>
          </button>
          {hasStyleFields && (
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
              <AtlasStylePanel nounId={tool.id} fields={tool.styleFields} />
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
            title={t(`creationTray.${tool.id}Tooltip`, { defaultValue: copy(tool.description ?? tool.label) })}
            aria-label={t(`creationTray.${tool.id}Label`, { defaultValue: copy(tool.label) })}
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
            <AtlasImageInput onSubmitPath={onImageSubmitPath} onSubmitFile={onImageSubmitFile} onSubmitText={onImageSubmitText} onDone={() => onImageToggle(false)} />
          </AnchoredOverlay>
        </Fragment>
      )
    }
    const armed = armedTool === tool.id
    // A drag-from-tray placement lands via a single drop point
    // (creation.placeAt's own guard skips a gesture-declaring tool
    // outright, since its placement is a drawn gesture, never a
    // click point) -- so any gesture-declaring tool reaching this
    // branch (drag-to-erase, ephemeral-drag) carries no drag source.
    // Area never reaches this branch at all (goal 0215 S2: its own
    // 'drag-to-draw' interaction routes it into the branch above).
    const draggable = tool.gesture === null
    return (
      <button
        key={tool.id}
        type="button"
        className={styles.tool}
        data-testid={`atlas-tray-${tool.id}`}
        data-armed={armed}
        aria-pressed={armed}
        title={t(`creationTray.${tool.id}Tooltip`, { defaultValue: copy(tool.description ?? tool.label) })}
        aria-label={t(`creationTray.${tool.id}Label`, { defaultValue: copy(tool.label) })}
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
  }

  return (
    <div className={styles.tray} data-testid="atlas-creation-tray" role="toolbar" aria-label={t('creationTray.ariaLabel')}>
      {primaryTools.map((tool) => renderToolButton(tool))}
      {annotateTools.length === 0 ? null : annotateArmedTool ? (
        // Armed: this tool's OWN button (+ style panel, if it has one)
        // renders exactly like a primary tool would -- the ONE
        // AnchoredOverlay invariant above. The generic trigger doesn't
        // exist right now; disarming (Escape, or re-clicking this same
        // button) brings it back next render. With NO annotate tools
        // at all (every one disabled, or the Drawing plugin off) the
        // trigger renders nothing -- a drawer with nothing to disclose
        // is a dead end, not an affordance.
        renderToolButton(annotateArmedTool)
      ) : (
        <Fragment>
          <button
            ref={annotateGroupAnchorRef}
            type="button"
            className={styles.tool}
            data-testid="atlas-tray-annotate-group"
            data-armed={false}
            aria-expanded={manualOpen}
            aria-haspopup="true"
            title={t('creationTray.annotateTooltip')}
            aria-label={t('creationTray.annotateLabel')}
            onClick={() => {
              // Table/Image's own popovers derive their `open` boolean
              // straight off armedToolId (useTablePickerSignal.ts,
              // useAtlasImagePopoverSignal.ts) and float in the SAME
              // 'outside-top of the tray' slot this drawer's own
              // popover does -- closing them here, before the drawer
              // opens, avoids the two colliding and swallowing the
              // click meant to arm a tool inside it (traced live: the
              // image paste-zone stayed open and intercepted the
              // pointer meant for Pencil's button, deadlocking the
              // re-arm).
              if (tablePickerOpen) onTableToggle(false)
              if (imagePopoverOpen) onImageToggle(false)
              setManualOpen((open) => !open)
            }}
          >
            <AnnotateGroupIcon size={14} />
            <ChevronDownIcon size={12} />
          </button>
          <AnchoredOverlay
            open={manualOpen}
            onClose={() => setManualOpen(false)}
            // Disabled for the same reason the header comment above
            // states: even a transient overlap between this drawer
            // unmounting and an armed tool's own style panel mounting
            // (the same render/commit that arms it) is enough to
            // reproduce the pan regression -- the trap/zone machinery
            // is unnecessary for a flat row of independent buttons
            // anyway.
            focusTrapSettings={{ disabled: true }}
            focusZoneSettings={{ disabled: true }}
            anchorRef={annotateGroupAnchorRef}
            renderAnchor={null}
            side="outside-top"
          >
            <div className={styles.annotateGroup} role="group" aria-label={t('creationTray.annotateLabel')}>
              {annotateTools.map((tool) => renderToolButton(tool))}
            </div>
          </AnchoredOverlay>
        </Fragment>
      )}
    </div>
  )
}
