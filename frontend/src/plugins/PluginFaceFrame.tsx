import { lazy, memo, useCallback, useMemo, useRef, type ComponentType } from 'react'
import type { BoardObject } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { AtlasService } from '../shared/bindings'
import type { MirrorReadState } from '../atlas/useAtlasObjectMirrorRead'
import type { FaceControls } from '../app/pluginFrameBridge'
import type { CanvasObjectDecl } from './sdk'
import { mirrorDataUrlFor } from './pluginFaceMirror'

// A plugin face drawn by its own entry page (goal 0349 S6): the same
// sandboxed frame a view or capture gets, mounted inside the board
// object's box. The object's data reaches the page as its context
// (`object`, and `mirror` for a file-backed kind), pushed again on
// every change; the page writes back through the bridge's own object
// doors. Everything around the frame -- the hover ring, the band, the
// click shield, the resize handles -- stays the host's, exactly as for
// a legacy same-DOM face.
//
// A framed face is always an interactive face in the activation
// contract: idle, the host's shield keeps the wheel, the drag and the
// keys on the canvas (a frame would otherwise swallow them); selected,
// the page receives them.

// The frame component is loaded lazily: this module sits on the
// activation path (canvasToolAdapter -> hostApi), which must stay free
// of the app's own component graph (loader.ts's import discipline);
// the board node renders every face under its own Suspense.
const PluginFrame = lazy(() => import('../app/PluginFrame').then((m) => ({ default: m.PluginFrame })))

export type PluginFaceFrameProps = {
  object: BoardObject
  mirrorVersion: number
  mirrorContent?: MirrorReadState
  onEditingChange?: (editing: boolean) => void
}

export function pluginFramedFaceComponent(pluginId: string, decl: CanvasObjectDecl, entry: string, version: string): ComponentType<PluginFaceFrameProps> {
  const fileSource = decl.source === 'file'
  const Face = memo(function PluginFramedFace({ object, mirrorContent, onEditingChange }: PluginFaceFrameProps) {
    const editingRef = useRef(onEditingChange)
    editingRef.current = onEditingChange
    // The context is rebuilt on VALUE change only (payload and size as
    // JSON, the mirror's data URL), so a plugin's own updatePayload
    // echo never pushes a stale context back into the page.
    const payloadJSON = JSON.stringify(object.Payload ?? {})
    const sizeJSON = object.Size ? JSON.stringify(object.Size) : ''
    const { dataUrl, failed } = mirrorDataUrlFor(mirrorContent)
    const context = useMemo(() => ({
      object: {
        ID: object.ID,
        Kind: object.Kind,
        Payload: JSON.parse(payloadJSON) as Record<string, string>,
        Size: sizeJSON ? (JSON.parse(sizeJSON) as { W: number; H: number }) : null,
      },
      ...(fileSource ? { mirror: { dataUrl, failed } } : {}),
      // eslint-disable-next-line react-hooks/exhaustive-deps -- payloadJSON/sizeJSON stand in for object.Payload/Size value identity (see above)
    }), [object.ID, object.Kind, payloadJSON, sizeJSON, dataUrl, failed])
    const face = useMemo<FaceControls>(() => ({
      updatePayload: async (patch) => { await AtlasService.SetBoardObjectPayload(object.ID, patch) },
      setEditing: (editing) => editingRef.current?.(!!editing),
    }), [object.ID])
    const onSink = useCallback(() => {}, [])
    return (
      <div style={{ width: '100%', height: '100%', overflow: 'hidden', display: 'flex' }} data-testid={`plugin-face-${decl.kind}`}>
        <PluginFrame
          pluginId={pluginId}
          surfaceId={decl.kind}
          title={decl.label}
          entry={entry}
          version={version}
          stateKey={`face:${decl.kind}:${object.ID}:state`}
          context={context}
          face={face}
          onSink={onSink}
          testId={`plugin-face-frame-${decl.kind}`}
        />
      </div>
    )
  })
  return Face
}
