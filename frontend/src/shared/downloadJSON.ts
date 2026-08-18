import { SettingsService } from './bindings'

// Every Export button's download mechanism (Atlas toolbar, Configure
// Requests/Lists/MCPServers, and CompositionView's own workflow
// export) routes through this one function. A synthetic anchor-click
// download needs the browser to supply a download handler -- the
// Wails webview doesn't provide one, so the anchor click is silently
// inert there even though nothing about it errors. Desktop mode
// therefore goes through SettingsService.SaveTextFile (the OS-native
// save dialog); server mode (a real browser tab) keeps the standard
// Blob + synthetic-anchor-click path, which works there exactly as it
// does in any other web app.
export async function downloadJSON(filename: string, json: string): Promise<void> {
  const buildInfo = await SettingsService.GetBuildInfo().catch(() => null)
  const isNativeWebview = buildInfo != null && !buildInfo.Server
  if (isNativeWebview) {
    await SettingsService.SaveTextFile(filename, json)
    return
  }
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
