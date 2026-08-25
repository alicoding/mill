import { AtlasService } from '../shared/bindings'
import { downloadJSON, downloadText } from '../shared/downloadJSON'
import { boardExportSummaryText } from './boardExportSummary'
import { refreshAtlas } from './atlasStore'
import { useAtlasImportConfirm } from './useAtlasImportConfirm'
import type { TFunction } from 'i18next'
import type { Card, Kind, Link, LinkKind } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'

// Whole-atlas export/import (split out of AtlasView.tsx at the
// 500-line convention): download the full map, or import a file with
// the overwrite-confirm flow. exportBoardDrawio is the goal 0194
// export slice's own sibling format on the SAME toolbar surface
// (AtlasToolbar's Export menu) -- scoped to viewedID's own board
// (its card subtree) rather than the whole graph, since a .drawio
// file is inherently one board, not a portable multi-space bundle.
export function useAtlasShareIO({ allKinds, allLinkKinds, allCards, allLinks, viewedID, t, onError, onSummary }: {
  allKinds: Kind[]
  allLinkKinds: LinkKind[]
  allCards: Card[]
  allLinks: Link[]
  viewedID: string
  t: TFunction<'atlas'>
  onError: (msg: string | null) => void
  onSummary: (message: string) => void
}) {
  const exportAtlas = () => {
    AtlasService.ExportAtlas()
      .then((json) => downloadJSON('atlas.json', json))
      .catch((err) => onError(String(err)))
  }

  const exportBoardDrawio = () => {
    AtlasService.ExportBoardAsDrawio(viewedID)
      .then((res) => downloadText('board.drawio', res.XML, 'application/xml').then(() => onSummary(boardExportSummaryText(t, res))))
      .catch((err) => onError(String(err)))
  }

  const runImport = (text: string) => {
    AtlasService.ImportAtlas(text)
      .then(() => { onError(null); void refreshAtlas() })
      .catch((err) => onError(String(err)))
  }
  const importConfirm = useAtlasImportConfirm({ kinds: allKinds, linkKinds: allLinkKinds, cards: allCards, links: allLinks, onImport: runImport })
  const importFile = (file: File) => {
    file.text().then(importConfirm.requestImport).catch((err) => onError(String(err)))
  }

  return { exportAtlas, exportBoardDrawio, importFile, importConfirmDialog: importConfirm.dialog }
}
