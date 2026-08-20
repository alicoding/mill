import { AtlasService } from '../shared/bindings'
import { downloadJSON } from '../shared/downloadJSON'
import { refreshAtlas } from './atlasStore'
import { useAtlasImportConfirm } from './useAtlasImportConfirm'
import type { Card, Kind, Link, LinkKind } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'

// Whole-atlas export/import (split out of AtlasView.tsx at the
// 500-line convention): download the full map, or import a file with
// the overwrite-confirm flow.
export function useAtlasShareIO({ allKinds, allLinkKinds, allCards, allLinks, onError }: {
  allKinds: Kind[]
  allLinkKinds: LinkKind[]
  allCards: Card[]
  allLinks: Link[]
  onError: (msg: string | null) => void
}) {
  const exportAtlas = () => {
    AtlasService.ExportAtlas()
      .then((json) => downloadJSON('atlas.json', json))
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

  return { exportAtlas, importFile, importConfirmDialog: importConfirm.dialog }
}
