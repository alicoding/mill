import { useTranslation } from 'react-i18next'
import { Button, Dialog, Stack, Text } from '@primer/react'
import { runCommand } from '../shared/commands'
import { openExternalUrl } from '../shared/openExternal'
import { useUISignalStore } from '../shared/uiSignalStore'
import { useUpdateNoticeStore } from '../shared/updateNoticeStore'
import mirrorStyles from '../atlas/AtlasCardMirrorPreview.module.css'

// The update changelog surface (goal 0220 S2): "What's new" renders
// the release notes CheckForUpdates most recently found -- the SAME
// server-rendered markdown shared/updateNoticeStore.ts already carries
// for the pill, through the SAME markdown adapter DocsView/the Atlas
// mirror preview use (goldmark, internal/adapters/markdown), so this
// never becomes a second half-built renderer. App-level chrome mounted
// once (same shape as ShortcutsHelpDialog), rendering off
// uiSignalStore's whatsNewOpen flag; opened only via the update.whatsNew
// command (shared/settingsCommands.ts) from either the pill's secondary
// link or the Settings status line's own link -- never a second onClick
// path (architecture.md's command-registry rule).
export function WhatsNewDialog() {
  const { t } = useTranslation('app')
  const open = useUISignalStore((s) => s.whatsNewOpen)
  const close = useUISignalStore((s) => s.closeWhatsNew)
  const notesVersion = useUpdateNoticeStore((s) => s.notesVersion)
  const notesHTML = useUpdateNoticeStore((s) => s.notesHTML)

  if (!open) return null

  return (
    // Dialog's own props don't forward data-testid to the DOM (only
    // 'data-component' is, see @primer/react's DialogProps -- verified
    // against the installed .d.ts, same finding ShortcutsHelpDialog.tsx
    // already relies on): the dialog itself is found by ARIA role+name
    // (its title doubles as the aria-label), same as every other Dialog
    // this codebase drives from e2e (fixtures/palette.ts's own
    // paletteDialog).
    <Dialog title={t('whatsNew.title')} onClose={close} width="520px" data-component="whats-new">
      {notesHTML ? (
        <Stack gap="condensed">
          <Text weight="semibold" size="small" data-testid="whats-new-version">
            {t('whatsNew.versionHeading', { version: notesVersion })}
          </Text>
          <div
            className={mirrorStyles.markdownBody}
            data-testid="whats-new-notes"
            onClick={(ev) => {
              // A release note commonly links out (a PR, an issue) --
              // a raw click would navigate this webview away from Mill
              // itself, the same reasoning DocsView's own anchor
              // interception already documents.
              const anchor = (ev.target as HTMLElement).closest('a')
              const href = anchor?.getAttribute('href')
              if (!href) return
              ev.preventDefault()
              void openExternalUrl(href)
            }}
            // Safe: goldmark's default (non-unsafe) render mode never
            // passes raw HTML through unescaped -- render_test.go pins
            // that property, the same trust boundary the Atlas mirror
            // preview and DocsView already rely on for this exact HTML
            // source.
            dangerouslySetInnerHTML={{ __html: notesHTML }}
          />
        </Stack>
      ) : (
        <Stack direction="horizontal" gap="condensed" align="center" data-testid="whats-new-empty">
          <Text size="small">{t('whatsNew.empty')}</Text>
          <Button size="small" onClick={() => void runCommand('update.check')} data-testid="whats-new-check">
            {t('whatsNew.checkButton')}
          </Button>
        </Stack>
      )}
    </Dialog>
  )
}
