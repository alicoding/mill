import { useCallback, useEffect, useRef } from 'react'
import { MirrorKind } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { AtlasService } from '../shared/bindings'
import { externalChangeActions, nextDrawioActions, type DrawioEmbedAction, type DrawioEmbedMessage } from './drawioEmbedProtocol'
import { useAtlasMirrorChanged } from './useAtlasMirrorChanged'

// The vendored full editor webapp, same-origin, never a remote host
// (goal 0237 S0 verdict: the locked-down-environment requirement forces
// this iframe+documented-protocol path to exist regardless, so the
// bundled copy rides it too -- one seam, zero reverse-engineered API).
// spin=1 shows the editor's own loading spinner until 'init' fires.
const EDITOR_URL = '/vendor/drawio/editor/index.html?embed=1&proto=json&spin=1'

// Mounts draw.io's real editor and wires its documented postMessage
// protocol to Mill's own save path (goal 0237 S1). initialXML is
// captured once at mount time -- the editor's 'init' handshake fires
// exactly once per iframe load, and re-sending 'load' mid-session on a
// prop change would overwrite the user's in-progress edit with
// whatever this component last rendered.
export function DrawioEditorMount({ objectID, initialXML, onExit, onError }: {
  objectID: string
  initialXML: string
  onExit: () => void
  onError: (message: string) => void
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const initialXMLRef = useRef(initialXML)
  // onExit/onError as refs, kept current every render without being
  // effect dependencies: DrawioEditorDialog (its one caller) can
  // re-render for reasons that have nothing to do with this mount (any
  // reactive board-data poll re-resolves its own `object` prop to a new
  // reference), and a naive dependency on those two callbacks would
  // tear down and re-add the message listener on every such render --
  // a real gap where a genuine 'autosave' from the iframe, arriving in
  // that exact window, would be silently dropped. The listener below
  // registers ONCE per objectID and reads these refs at call time
  // instead.
  const onExitRef = useRef(onExit)
  const onErrorRef = useRef(onError)
  // The bytes this editor itself last wrote to the mirror -- the one
  // thing that tells our own autosave apart from someone else's write
  // when the file watch fires (externalChangeActions' own contract).
  const lastWrittenRef = useRef(initialXML)
  // Ref writes belong in an effect, never directly in the render body
  // (React's own react-hooks/refs rule) -- this one has no dependency
  // array so it re-runs after every render, keeping both refs current.
  useEffect(() => {
    onExitRef.current = onExit
    onErrorRef.current = onError
  })

  const runActions = useCallback((actions: DrawioEmbedAction[]) => {
    for (const action of actions) {
      if (action.type === 'sendToEditor') {
        iframeRef.current?.contentWindow?.postMessage(JSON.stringify(action.message), window.location.origin)
      } else if (action.type === 'writeMirror') {
        lastWrittenRef.current = action.xml
        AtlasService.WriteObjectMirror(objectID, action.xml).catch((err) => onErrorRef.current(String(err)))
      } else if (action.type === 'close') {
        onExitRef.current()
      }
    }
  }, [objectID])

  // An edit that reached the file from anywhere else -- an agent's
  // guarded write over MCP (goal 0323), another app saving over the
  // same path -- lands in the open editor instead of being invisible
  // until it is reopened.
  useAtlasMirrorChanged(objectID, useCallback(() => {
    AtlasService.ObjectMirrorContent(objectID)
      .then((content) => {
        if (content.Missing || content.Kind !== MirrorKind.MirrorKindText) return
        runActions(externalChangeActions(content.Content, lastWrittenRef.current))
      })
      .catch((err) => onErrorRef.current(String(err)))
  }, [objectID, runActions]))

  useEffect(() => {
    const handleMessage = (ev: MessageEvent) => {
      // Same-origin double gate: the SOURCE window must be this exact
      // iframe (never a message some other same-origin script sent)
      // and the ORIGIN must be Mill's own -- an iframe pointed at a
      // remote engine (a future source-override, goal 0237 S2) would
      // fail this and be silently ignored rather than trusted.
      if (ev.source !== iframeRef.current?.contentWindow) return
      if (ev.origin !== window.location.origin) return
      let message: DrawioEmbedMessage
      try {
        message = JSON.parse(String(ev.data)) as DrawioEmbedMessage
      } catch {
        return
      }
      runActions(nextDrawioActions(message, initialXMLRef.current))
    }
    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [objectID, runActions])

  return (
    <iframe
      ref={iframeRef}
      src={EDITOR_URL}
      title="drawio-editor"
      data-testid="drawio-editor-frame"
      style={{ width: '100%', height: '100%', border: 'none', display: 'block' }}
    />
  )
}
