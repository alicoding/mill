import { useEffect, useRef, useState } from 'react'
import type { MirrorContent } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { AtlasService } from '../shared/bindings'

// MirrorReadState -- what AtlasBoardObjectNode.tsx hands a fileBacked
// extension's Component instead of the extension calling
// ObjectMirrorContent itself (ADR-0046, goal 0244 S1b: the kernel
// import boundary becomes real -- extensions/ has no import path to
// AtlasService at all). content stays undefined until the read
// resolves; error carries a REJECTED read's own message, kept separate
// from a successful response that happens to be Missing/TooLarge (those
// are fields on `content`, not a fetch failure) so each relocated
// extension's own error/loading/missing branches read exactly as they
// did before relocation.
export interface MirrorReadState {
  content: MirrorContent | undefined
  error: string | undefined
}

const NOT_LOADED: MirrorReadState = { content: undefined, error: undefined }

// useAtlasObjectMirrorRead -- the ONE place ObjectMirrorContent is
// called for a placed board object. Before this slice,
// AtlasMirrorImageContent/AtlasSheetObjectContent/AtlasDiagramObjectContent
// each ran their own copy of this same fetch; this hook is their
// relocation, not a rewrite -- it preserves the two distinct timing
// contracts those three components separately established:
//
//   - an identity change (a new object, or the SAME object's
//     mirrorPath changing via a re-pick) resets to NOT_LOADED before
//     refetching, so the fallback/placeholder shows again;
//   - a live mirrorVersion bump (goal 0194's fsnotify round-trip)
//     refetches WITHOUT resetting first, so an external edit swaps the
//     rendered content in place with no loading flash.
//
// Only diagram/sheet mirrors (.drawio/.mmd/.xlsx/.csv --
// internal/domain/atlas/mirror.go's diagramMirrorExtensions) ever
// actually receive a version bump in practice: image/ink extensions
// aren't in that watch gate, so the second effect below never fires for
// them today, matching their own pre-relocation behavior exactly (that
// component's own mirrorVersion dependency was already forward-compat
// dead code, per its own prior header comment).
export function useAtlasObjectMirrorRead(objectID: string, mirrorPath: string | undefined, fileBacked: boolean, mirrorVersion: number): MirrorReadState {
  const [state, setState] = useState<MirrorReadState>(NOT_LOADED)
  const mountedVersion = useRef(mirrorVersion)

  useEffect(() => {
    if (!fileBacked) {
      setState(NOT_LOADED)
      return undefined
    }
    let stale = false
    mountedVersion.current = mirrorVersion
    setState(NOT_LOADED)
    AtlasService.ObjectMirrorContent(objectID)
      .then((content) => { if (!stale) setState({ content, error: undefined }) })
      .catch((err) => { if (!stale) setState({ content: undefined, error: String(err) }) })
    return () => { stale = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mirrorVersion is deliberately excluded from this effect's deps: a version bump is handled by the effect below, which refetches WITHOUT resetting to NOT_LOADED first (the no-flash live-reload contract).
  }, [objectID, mirrorPath, fileBacked])

  useEffect(() => {
    if (!fileBacked || mirrorVersion === mountedVersion.current) return undefined
    mountedVersion.current = mirrorVersion
    let stale = false
    AtlasService.ObjectMirrorContent(objectID)
      .then((content) => { if (!stale) setState({ content, error: undefined }) })
      .catch((err) => { if (!stale) setState({ content: undefined, error: String(err) }) })
    return () => { stale = true }
  }, [mirrorVersion, fileBacked, objectID])

  return state
}
