import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Text } from '@primer/react'
import { PluginFrame } from '../app/PluginFrame'
import { getPluginView, setPluginViewSink } from './pluginViews'
import { usePluginReloadVersion } from './pluginReloadSignal'
import { currentPluginTheme, onPluginThemeChange, pluginThemeAttrs, usePluginTheme } from './pluginTheme'
import listStyles from '../shared/ListCard.module.css'

// A plugin-contributed view mounted in the BOARD'S region (goal 0357,
// placement 'board-switcher'): the same surface PluginViewHost mounts
// as a work tab (docs/goals/0290), one seam higher in plugins/ because
// atlas/ never imports app/ (.dependency-cruiser.cjs's domain-folders
// rule) -- a framed entry page, or the plugin's render(el) for a view
// that declared no page. The pane's own context adds spaceCardId --
// the space being viewed -- so the plugin scopes its contents the way
// the board itself does.
export function PluginBoardPane({ pluginId, viewId, spaceCardId }: { pluginId: string; viewId: string; spaceCardId: string }) {
  const { t } = useTranslation('app')
  const ref = useRef<HTMLDivElement>(null)
  // A reload replaces the plugin's page bytes or registered render, so
  // an open pane redraws from the fresh version rather than holding the
  // previous one until the view is switched away and back (goal 0319).
  const reloadVersion = usePluginReloadVersion()
  const view = getPluginView(pluginId, viewId)
  const theme = usePluginTheme()
  const context = useMemo(() => ({ pluginId, viewId, spaceCardId }), [pluginId, viewId, spaceCardId])
  const onSink = useCallback((post: ((message: unknown) => void) | undefined) => setPluginViewSink(pluginId, viewId, post), [pluginId, viewId])
  useEffect(() => {
    const el = ref.current
    if (!el || !view || !view.render) return
    try {
      el.replaceChildren()
      view.render(el, { pluginId, viewId, theme: currentPluginTheme(), onThemeChange: onPluginThemeChange })
    } catch (err) {
      console.error(`plugin ${pluginId}: view "${viewId}" failed to render`, err)
    }
  }, [view, pluginId, viewId, reloadVersion])
  if (!view) {
    return <Text as="p" size="small" className={listStyles.muted} data-testid="plugin-view-missing">{t('pluginView.missing')}</Text>
  }
  if (view.entry) {
    return (
      <PluginFrame
        key={`${pluginId}/${viewId}/${reloadVersion}`}
        pluginId={pluginId}
        surfaceId={viewId}
        title={view.title}
        entry={view.entry}
        version={view.version}
        stateKey={`view:${viewId}:state`}
        paletteAccess
        context={context}
        onSink={onSink}
        onPageMessage={(message) => view.onMessage?.(message)}
        testId={`plugin-view-${pluginId}-${viewId}`}
      />
    )
  }
  return <div ref={ref} data-testid={`plugin-view-${pluginId}-${viewId}`} style={{ height: '100%', overflow: 'auto' }} {...pluginThemeAttrs(theme)} />
}
