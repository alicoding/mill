import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Stack, Text } from '@primer/react'
import { Events } from '@wailsio/runtime'
import { pluginAPIFor } from '../plugins/hostApi'
import { pluginThemeAttrs, usePluginTheme } from '../plugins/pluginTheme'
import { attachFrameBridge, sendFrameEvent, sendFrameMessage, type CaptureControls, type FaceControls } from './pluginFrameBridge'
import { buildFrameSrcdoc, frameBootstrapUrl, hostTokenReader, millTokenCss, pluginAssetBase } from './pluginFrameBootstrap'
import { PluginService } from '../../bindings/github.com/alicoding/mill/internal/services/pluginsvc'
import type { GuardedActionResult } from '../plugins/sdk/guardedAction'
import listStyles from '../shared/ListCard.module.css'
import frameStyles from './PluginFrame.module.css'
import { bindingsResolvingToCommand } from '../shared/commandDispatch'
import { menuOwnershipSnapshot, subscribeMenuOwnership } from '../shared/menuOwnership'
import { useAppStore } from '../shared/store'

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
  /** A canvas object's face only (goal 0380 S2): whether the host has
   * just handed this face its editing moment -- pushed as
   * `face:activate`/`face:deactivate`. Undefined for a view or
   * capture, which draw the same distinction the click shield already
   * enforces at the pointer/wheel/key level; this is the one thing a
   * sandboxed page cannot observe for itself. */
  active?: boolean
  /** Lets this main-window surface request only palette.open by shortcut. */
  paletteAccess?: boolean
  /** Installs (and clears) the sink the plugin's postMessage uses. */
  onSink: (post: ((message: unknown) => void) | undefined) => void
  /** The plugin's own inbound handler for what the page posts. */
  onPageMessage?: (message: unknown) => void
  testId: string
}

// PendingAsk is one in-flight inline confirmation (goal 0374): the
// banner PluginFrame itself renders, outside the sandboxed frame, for
// a guarded write whose rule says "ask". resolve settles the promise
// performGuardedWrite is holding open -- true only from THIS
// component's own Post click, never from anything the frame sent.
interface PendingAsk {
  description: string
  resolve: (confirmed: boolean) => void
}

export function PluginFrame(props: PluginFrameProps) {
  const { t } = useTranslation('app')
  const { pluginId, entry, version, stateKey, title, context, testId } = props
  const frameRef = useRef<HTMLIFrameElement>(null)
  const [srcdoc, setSrcdoc] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const [pendingAsk, setPendingAsk] = useState<PendingAsk | null>(null)
  const theme = usePluginTheme()
  const api = pluginAPIFor(pluginId)
  const keybindingOverrides = useAppStore((state) => state.keybindingOverrides)
  const activeKind = useAppStore((state) => state.view.kind)
  const menuOwnershipVersion = useSyncExternalStore(subscribeMenuOwnership, menuOwnershipSnapshot, menuOwnershipSnapshot)
  const paletteBindings = useMemo(
    () => {
      // The version is the external-store signal that native menu
      // ownership changed; the resolver reads the owned set itself.
      void menuOwnershipVersion
      return props.paletteAccess ? bindingsResolvingToCommand('palette.open', keybindingOverrides, activeKind) : []
    },
    [props.paletteAccess, keybindingOverrides, activeKind, menuOwnershipVersion],
  )
  const contextRef = useRef(context)
  const paletteBindingsRef = useRef(paletteBindings)

  useEffect(() => {
    contextRef.current = context
    paletteBindingsRef.current = paletteBindings
  }, [context, paletteBindings])

  // performGuardedWrite is the ONLY place confirmed=true is ever set
  // (goal 0374 amendment 1): the frame's own performGuardedAction call
  // reaches here, never Go directly, so an "ask" outcome always shows
  // THIS component's own banner before a second, confirmed call is
  // ever made -- the frame cannot skip it, and cannot supply confirmed
  // itself, since this function's signature never takes one.
  const performGuardedWrite = useCallback(async (kind: string, attributes: Record<string, string>, description: string): Promise<GuardedActionResult> => {
    const verdict = await PluginService.EvaluateGuardedActionForPlugin(pluginId, kind, attributes)
    if (verdict.Effect !== 'ask') {
      const r = await PluginService.PerformGuardedActionForPlugin(pluginId, kind, attributes, description, false)
      return { approved: r.Approved, effect: r.Effect, ruleLabel: r.RuleLabel, performed: r.Performed }
    }
    const confirmed = await new Promise<boolean>((resolve) => setPendingAsk({ description, resolve }))
    setPendingAsk(null)
    if (!confirmed) return { approved: false, effect: verdict.Effect, ruleLabel: verdict.RuleLabel, performed: false }
    const r = await PluginService.PerformGuardedActionForPlugin(pluginId, kind, attributes, description, true)
    return { approved: r.Approved, effect: r.Effect, ruleLabel: r.RuleLabel, performed: r.Performed }
  }, [pluginId])

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
      setSrcdoc(buildFrameSrcdoc(pluginAssetBase(pluginId), [frameBootstrapUrl()], html, { theme, state, context, paletteBindings }, millTokenCss(hostTokenReader())))
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
      guardedWrite: { perform: performGuardedWrite },
      paletteAccess: props.paletteAccess,
      onPageMessage: props.onPageMessage,
      onState: (state) => { void api.storage.set(stateKey, state).catch((err: unknown) => console.error(`plugin ${pluginId}: view state could not be saved`, err)) },
      onReady: () => {
        sendFrameEvent(frame, 'ctx', contextRef.current)
        sendFrameEvent(frame, 'palette-bindings', paletteBindingsRef.current)
      },
    })
    props.onSink((message: unknown) => sendFrameMessage(frame, message))
    return () => {
      detach()
      props.onSink(undefined)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the sink and the handlers are stable for a mounted surface
  }, [api, srcdoc, pluginId, stateKey, props.paletteAccess])

  // Theme, settings and board changes are pushed in; the page decides
  // what to do with each.
  useEffect(() => {
    sendFrameEvent(frameRef.current, 'theme:changed', theme, millTokenCss(hostTokenReader()))
  }, [theme, srcdoc])

  useEffect(() => {
    sendFrameEvent(frameRef.current, 'ctx', context)
  }, [context, srcdoc])

  // face:activate/face:deactivate (goal 0380 S2): pushed only when the
  // caller actually passes `active` -- a view or capture never does, so
  // this is a no-op for either. Fires once on mount too (an object
  // face always mounts idle/selected, never editing, so the initial
  // 'face:deactivate' is a correct, harmless echo of that fact).
  useEffect(() => {
    if (props.active === undefined || srcdoc === null) return
    sendFrameEvent(frameRef.current, props.active ? 'face:activate' : 'face:deactivate', {})
  }, [props.active, srcdoc])

  useEffect(() => {
    sendFrameEvent(frameRef.current, 'palette-bindings', paletteBindings)
  }, [paletteBindings, srcdoc])

  useEffect(() => {
    if (srcdoc === null) return
    return Events.On('mill-data-changed', (evt) => {
      const data = evt.data as { entity?: string; id?: string; kind?: string } | undefined
      if (data?.entity === 'atlas') sendFrameEvent(frameRef.current, 'contents:changed', { id: data.id ?? '', kind: data.kind })
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
    <div className={frameStyles.host}>
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
        // Same theming contract as every other plugin host element (goal
        // 0349 S1): the resolved theme rides the host node's attributes so
        // a stylesheet outside the frame (and the theme conformance check)
        // can read it with no JavaScript.
        {...pluginThemeAttrs(theme)}
        // The frame fills the box its host hands it. An iframe's own
        // intrinsic height is 150px, so the host must give it a definite
        // one; flex is how every other filling surface here does it.
        style={{ width: '100%', height: '100%', flex: '1 1 auto', minHeight: 0, border: 0, display: 'block', colorScheme: 'normal' }}
      />
      {/* The inline "ask" banner (goal 0374): rendered here, outside the
          sandboxed frame, so the frame can never assert its own
          confirmation -- docked to the bottom of this view's own box,
          not a modal, not a detour through the Review queue. */}
      {pendingAsk && (
        <Stack direction="horizontal" gap="condensed" align="center" className={frameStyles.askBanner} data-testid={`${testId}-guarded-ask`}>
          <Text size="small">{t('pluginView.guardedWrite.confirm')}</Text>
          <Button size="small" variant="primary" data-testid={`${testId}-guarded-ask-confirm`} onClick={() => pendingAsk.resolve(true)}>
            {pendingAsk.description}
          </Button>
          <Button size="small" data-testid={`${testId}-guarded-ask-cancel`} onClick={() => pendingAsk.resolve(false)}>
            {t('pluginView.guardedWrite.cancel')}
          </Button>
        </Stack>
      )}
    </div>
  )
}
