import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Events } from '@wailsio/runtime'
import { AtlasService } from '../shared/bindings'
import { titleFromFilename } from './atlasCreateHelpers'
import { refreshAtlas } from './atlasStore'
import { useAtlasFolderImportRequestStore } from './atlasFolderImportRequest'
import { FILE_DROP_EVENT_NAME, FILE_DROP_CONTEXT_BOARD } from './atlasFileDropShared'
import { frameContainingPoint } from './atlasFramePoint'
import { isDiagramPath, useAtlasDiagramObjectCreate } from './useAtlasDiagramObjectCreate'
import type { FrameBox } from './useAtlasDragFiling'

const DROP_ERROR_MS = 4000
const PULSE_MS = 1200
const PULSE_MS_REDUCED = 1500

// The board-context half of the native OS file-drop door (goal 0081
// slice A3, LOCKED design §3b): a single non-directory file lands
// instantly at the drop point (a brief settle pulse, the ⌘K jump
// convention), no popover; 2+ paths or a single directory hand off to
// the existing folder-import preview via atlasFolderImportRequest.ts,
// prescoped to the drop's own parent. Card-foremost drops (D5) are a
// separate hook (useAtlasCardPageFileDrop, used by AtlasCardOverlay) --
// routed by the dropped-on element's own data-file-drop-context
// attribute, never by guessing app state here.
export function useAtlasNativeFileDrop({ parentID, topLevelBoxes, screenToFlowPosition, setPulsedID, reduceMotion }: {
  parentID: string
  topLevelBoxes: FrameBox[]
  screenToFlowPosition: (p: { x: number; y: number }) => { x: number; y: number }
  setPulsedID: (id: string | null) => void
  reduceMotion: boolean
}) {
  const { t } = useTranslation('atlas')
  const [dropError, setDropError] = useState<string | null>(null)
  const [dropDuplicateNotice, setDropDuplicateNotice] = useState<string | null>(null)
  const requestFolderImport = useAtlasFolderImportRequestStore((s) => s.requestFolderImport)
  const diagramObjectCreate = useAtlasDiagramObjectCreate()

  // Latest-refs (useBoardFocus.ts's own convention): the Events.On
  // subscription below is set up once and must never re-fire on every
  // unrelated re-render, but always needs this render's current values.
  const stateRef = useRef({ parentID, topLevelBoxes, screenToFlowPosition, requestFolderImport, setPulsedID, reduceMotion, diagramObjectCreate })
  useEffect(() => {
    stateRef.current = { parentID, topLevelBoxes, screenToFlowPosition, requestFolderImport, setPulsedID, reduceMotion, diagramObjectCreate }
  }, [parentID, topLevelBoxes, screenToFlowPosition, requestFolderImport, setPulsedID, reduceMotion, diagramObjectCreate])

  useEffect(() => {
    return Events.On(FILE_DROP_EVENT_NAME, (evt) => {
      const payload = evt.data as { filenames?: string[]; x?: number; y?: number; context?: string } | undefined
      if (!payload || payload.context !== FILE_DROP_CONTEXT_BOARD || !payload.filenames?.length) return
      const { topLevelBoxes: boxes, screenToFlowPosition: toFlow, parentID: currentParentID, requestFolderImport: request, setPulsedID: pulse, reduceMotion: reduced, diagramObjectCreate: diagramCreate } = stateRef.current
      const point = toFlow({ x: payload.x ?? 0, y: payload.y ?? 0 })
      const targetParentID = frameContainingPoint(boxes, point) ?? currentParentID

      AtlasService.ResolveFileDropRoute(payload.filenames)
        .then((route) => {
          if (route.Kind === 'import') {
            request(route.Path, targetParentID)
            return
          }
          const path = route.Path
          // A dropped .drawio/.mmd/.mermaid file lands as a "diagram"
          // board object, never a card (goal 0179 S2) -- no pulse/
          // duplicate-notice machinery applies, since a board object
          // carries neither.
          if (isDiagramPath(path)) {
            return diagramCreate.land(path, targetParentID, { X: point.x, Y: point.y })
          }
          return AtlasService.CreateCardFromFileDrop(path, titleFromFilename(path), targetParentID, { X: point.x, Y: point.y })
            .then((result) => refreshAtlas().then(() => {
              pulse(result.Card.ID)
              window.setTimeout(() => pulse(null), reduced ? PULSE_MS_REDUCED : PULSE_MS)
              if (result.DuplicateOfTitle) {
                setDropDuplicateNotice(t('board.dropDuplicateNotice', { title: result.DuplicateOfTitle }))
              }
            }))
        })
        .catch(() => setDropError(t('capture.dropError')))
    })
  }, [t])

  useEffect(() => {
    if (!dropError) return
    const timer = window.setTimeout(() => setDropError(null), DROP_ERROR_MS)
    return () => window.clearTimeout(timer)
  }, [dropError])

  useEffect(() => {
    if (!dropDuplicateNotice) return
    const timer = window.setTimeout(() => setDropDuplicateNotice(null), DROP_ERROR_MS)
    return () => window.clearTimeout(timer)
  }, [dropDuplicateNotice])

  return { dropError, dropDuplicateNotice }
}
