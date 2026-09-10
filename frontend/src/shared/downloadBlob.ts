import { blobToBase64 } from './base64Blob'
import { SettingsService } from './bindings'

// Binary exports use the native save dialog in the desktop webview and
// preserve the browser download mechanism in server mode.
export async function downloadBlob(filename: string, blob: Blob): Promise<void> {
  const buildInfo = await SettingsService.GetBuildInfo()
  if (!buildInfo.Server) {
    await SettingsService.SaveBinaryFile(filename, await blobToBase64(blob))
    return
  }
  const url = URL.createObjectURL(blob)
  try {
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
  } finally {
    URL.revokeObjectURL(url)
  }
}
