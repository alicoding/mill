import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Text } from '@primer/react'
import { getPluginView } from '../plugins/pluginViews'
import { usePluginReloadVersion } from '../plugins/pluginReloadSignal'
import listStyles from '../shared/ListCard.module.css'

// PluginViewHost -- the work-tab panel a plugin draws into (docs/goals/
// 0290): one host-owned div, the plugin's render(el, ctx) called once
// per mount. The panel stays mounted while its tab is hidden (the
// shell's rule for every tab), so the plugin's DOM survives switching
// tabs; after an app reload the restored tab mounts fresh and render
// runs again. A tab whose plugin is no longer loaded is pruned by the
// shell before this renders -- the fallback below is the honest
// answer if one ever slips through.
export function PluginViewHost({ pluginId, viewId }: { pluginId: string; viewId: string }) {
  const { t } = useTranslation('app')
  const ref = useRef<HTMLDivElement>(null)
  // A reload replaces the plugin's registered render, so an open tab
  // redraws from the fresh module rather than holding the previous
  // one's callback until the tab is closed and reopened (goal 0319).
  const reloadVersion = usePluginReloadVersion()
  const view = getPluginView(pluginId, viewId)
  useEffect(() => {
    const el = ref.current
    if (!el || !view) return
    try {
      el.replaceChildren()
      view.render(el, { pluginId, viewId })
    } catch (err) {
      console.error(`plugin ${pluginId}: view "${viewId}" failed to render`, err)
    }
  }, [view, pluginId, viewId, reloadVersion])
  if (!view) {
    return <Text as="p" size="small" className={listStyles.muted} data-testid="plugin-view-missing">{t('pluginView.missing')}</Text>
  }
  return <div ref={ref} data-testid={`plugin-view-${pluginId}-${viewId}`} style={{ height: '100%', overflow: 'auto' }} />
}
