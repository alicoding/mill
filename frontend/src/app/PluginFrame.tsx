import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Text } from '@primer/react'
import { Events } from '@wailsio/runtime'
import { pluginAPIFor } from '../plugins/hostApi'
import { usePluginTheme } from '../plugins/pluginTheme'
import { attachFrameBridge, sendFrameEvent, sendFrameMessage, type CaptureControls, type FaceControls } from './pluginFrameBridge'
import { buildFrameSrcdoc, frameBootstrapUrl, hostTokenReader, millTokenCss, pluginAssetBase } from './pluginFrameBootstrap'
import listStyles from '../shared/ListCard.module.css'

// PluginFrame mounts one plugin-owned page in its own sandboxed frame
// (docs/goals/0349, docs/adr/0047): the plugin's entry HTML, fetched
// through the asset route, handed to the frame as srcdoc with Mill's
// own head pieces prepended.
//
// sandbox WITHOUT allow-same-origin is the whole point: the page runs
// on an opaque origin, so it can reach neither Mill's DOM nor its
// storage, and a script error inside it stays inside it. Everything it
// needs from Mill arrives over the postMessage bridge.
//
// The srcdoc is built ONCE per mount. A theme change, a settings
// change, a new context and a resize are all pushed in as events
// instead: rebuilding the document would reload the page and throw
// away whatever the person has in it.

export interface PluginFrameProps {
  pluginId: string
  surfaceId: string
  /** The tab title or capture label, the frame's accessible name. */
  title: string
  entry: string
  version: string
  /** Where the plugin's own getState/setState value is persisted. */
  stateKey: string
  /** The surface's context, pushed in on mount and on every change. */
  context: Record<string, unknown>
  capture?: CaptureControls
  /** A canvas object's face: the object doors the page may call. */
  face?: FaceControls
  /** Installs (and clears) the sink the plugin's postMessage uses. */
  onSink: (post: ((message: unknown) => void) | undefined) => void
  /** The plugin's own inbound handler for what the page posts. */
  onPageMessage?: (message: unknown) => void
  testId: string
}

export function PluginFrame(props: PluginFrameProps) {
  const { t } = useTranslation('app')
  const { pluginId, entry, version, stateKey, title, context, testId } = props
  const frameRef = useRef<HTMLIFrameElement>(null)
  const [srcdoc, setSrcdoc] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const theme = usePluginTheme()
  const api = pluginAPIFor(pluginId)

  // The page's own bytes, fetched once. The version rides the query so
  // a reinstalled plugin never serves a cached page.
  useEffect(() => {
    let live = true
    setSrcdoc(null)
    setFailed(false)
    const load = async () => {
      const response = await fetch(`/plugins/${pluginId}/${entry}?v=${encodeURIComponent(version)}`)
      if (!response.ok) throw new Error(String(response.status))
      const html = await response.text()
      if (!live) return
      const state = api?.storage.get(stateKey)
      setSrcdoc(buildFrameSrcdoc(pluginAssetBase(pluginId), frameBootstrapUrl(), html, { theme, state, context }, millTokenCss(hostTokenReader())))
    }
    load().catch((err: unknown) => {
      if (!live) return
      console.error(`plugin ${pluginId}: entry page "${entry}" could not be loaded`, err)
      setFailed(true)
    })
    return () => { live = false }
    // The theme and the context are the frame's INITIAL values only;
    // later changes ride the event channel below rather than rebuilding
    // the document.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pluginId, entry, version, stateKey, api])

  // The bridge lives as long as this frame does, and answers only
  // messages whose source IS this frame's own window.
  useEffect(() => {
    const frame = frameRef.current
    if (!frame || !api || srcdoc === null) return
    const detach = attachFrameBridge({
      frame,
      api,
      capture: props.capture,
      face: props.face,
      onPageMessage: props.onPageMessage,
      onState: (state) => { void api.storage.set(stateKey, state).catch((err: unknown) => console.error(`plugin ${pluginId}: view state could not be saved`, err)) },
      onReady: () => sendFrameEvent(frame, 'ctx', context),
    })
    props.onSink((message: unknown) => sendFrameMessage(frame, message))
    return () => {
      detach()
      props.onSink(undefined)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the sink and the handlers are stable for a mounted surface
  }, [api, srcdoc, pluginId, stateKey])

  // Theme, settings and board changes are pushed in; the page decides
  // what to do with each.
  useEffect(() => {
    sendFrameEvent(frameRef.current, 'theme:changed', theme, millTokenCss(hostTokenReader()))
  }, [theme, srcdoc])

  useEffect(() => {
    sendFrameEvent(frameRef.current, 'ctx', context)
  }, [context, srcdoc])

  useEffect(() => {
    if (srcdoc === null) return
    return Events.On('mill-data-changed', (evt) => {
      const data = evt.data as { entity?: string; id?: string } | undefined
      if (data?.entity === 'atlas') sendFrameEvent(frameRef.current, 'contents:changed', { id: data.id ?? '' })
      if (data?.entity === 'settings') sendFrameEvent(frameRef.current, 'settings:changed', {})
    })
  }, [srcdoc])

  // The box the page is drawn in, so a page that lays out in script
  // (a canvas, a chart) knows its size without measuring the window.
  useEffect(() => {
    const frame = frameRef.current
    if (!frame || srcdoc === null || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect
      if (box) sendFrameEvent(frame, 'resize', { width: box.width, height: box.height })
    })
    observer.observe(frame)
    return () => observer.disconnect()
  }, [srcdoc])

  if (failed) {
    return <Text as="p" size="small" className={listStyles.muted} data-testid={`${testId}-failed`}>{t('pluginView.entryFailed')}</Text>
  }
  if (srcdoc === null) return <div data-testid={`${testId}-loading`} style={{ height: '100%', flex: '1 1 auto' }} />
  return (
    <iframe
      ref={frameRef}
      // No allow-same-origin: the page's origin stays opaque, which is
      // what keeps it out of Mill's document, cookies and storage.
      sandbox="allow-scripts allow-forms"
      srcDoc={srcdoc}
      title={title}
      data-testid={testId}
      data-plugin-id={pluginId}
      data-surface-id={props.surfaceId}
      // The frame fills the box its host hands it. An iframe's own
      // intrinsic height is 150px, so the host must give it a definite
      // one; flex is how every other filling surface here does it.
      style={{ width: '100%', height: '100%', flex: '1 1 auto', minHeight: 0, border: 0, display: 'block', colorScheme: 'normal' }}
    />
  )
}
