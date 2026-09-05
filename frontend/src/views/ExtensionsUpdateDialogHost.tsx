import { useEffect, useState } from 'react'
import { PluginService } from '../../bindings/github.com/alicoding/mill/internal/services/pluginsvc'
import type { InstallPreview } from '../../bindings/github.com/alicoding/mill/internal/services/pluginsvc/models'
import { useUISignalStore } from '../shared/uiSignalStore'
import { applyUpdate } from '../shared/extensionUpdatesStore'
import { pushNotice } from '../shared/noticeStore'
import { appTranslate, messageFor } from '../shared/userError'
import { ExtensionsInstallDialog } from './ExtensionsInstallDialog'

// The one place an update is confirmed (docs/goals/0349 S5). The
// `extension.update` command -- from the Updates tab, the row menu or
// the palette -- raises a request here; this host previews the newer
// version and shows the SAME prompt the first install showed, with the
// same acknowledgment at the unverified tier, then applies it. Mounted
// once by the Extensions page, so every path to an update confirms
// through one dialog.
export function ExtensionsUpdateDialogHost() {
  const request = useUISignalStore((s) => s.extensionUpdateRequest)
  const consume = useUISignalStore((s) => s.consumeExtensionUpdate)
  const [pending, setPending] = useState<{ id: string; preview: InstallPreview } | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (request === null) return
    const id = request
    consume()
    setBusy(true)
    PluginService.PreviewUpdate(id)
      .then((preview) => setPending({ id, preview }))
      .catch((err) => pushNotice({ level: 'error', text: messageFor(err, appTranslate) }))
      .finally(() => setBusy(false))
  }, [request, consume])

  if (pending === null) return null
  const confirm = () => {
    setBusy(true)
    applyUpdate(pending.id, pending.preview.Name || pending.id)
      .then(() => setPending(null))
      .catch((err) => pushNotice({ level: 'error', text: messageFor(err, appTranslate) }))
      .finally(() => setBusy(false))
  }
  return (
    <ExtensionsInstallDialog
      preview={pending.preview}
      mode="update"
      busy={busy}
      onCancel={() => setPending(null)}
      onInstall={confirm}
    />
  )
}
