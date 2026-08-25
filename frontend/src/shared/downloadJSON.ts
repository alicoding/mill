import { SettingsService } from './bindings'

// Every Export button's TEXT download mechanism (Atlas toolbar,
// Configure Requests/Lists/MCPServers, CompositionView's own workflow
// export, and Atlas's own board-as-.drawio export) routes through this
// one function. A synthetic anchor-click download needs the browser to
// supply a download handler -- the Wails webview doesn't provide one,
// so the anchor click is silently inert there even though nothing
// about it errors. Desktop mode therefore goes through
// SettingsService.SaveTextFile (the OS-native save dialog); server mode
// (a real browser tab) keeps the standard Blob + synthetic-anchor-click
// path, which works there exactly as it does in any other web app.
export async function downloadText(filename: string, content: string, mimeType: string): Promise<void> {
  const buildInfo = await SettingsService.GetBuildInfo().catch(() => null)
  const isNativeWebview = buildInfo != null && !buildInfo.Server
  if (isNativeWebview) {
    await SettingsService.SaveTextFile(filename, content)
    return
  }
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export function downloadJSON(filename: string, json: string): Promise<void> {
  return downloadText(filename, json, 'application/json')
}
