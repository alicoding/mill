import { Browser } from '@wailsio/runtime'
import { Heading, Label, Stack, Text, Button, type LabelProps } from '@primer/react'
import { CapabilitiesService } from '../bindings/github.com/alicoding/mill'
import { ViewKind } from '../bindings/github.com/alicoding/mill/internal/domain/capabilities/models'
import type { Capability } from '../bindings/github.com/alicoding/mill/internal/domain/capabilities/models'
import { useAppStore, type View } from './store'
import styles from './RunbookView.module.css'

const STATUS_VARIANT: Record<string, LabelProps['variant']> = {
  LOCKED: 'success',
  OPEN: 'attention',
  PARKED: 'secondary',
}

// Only meaningful in dev mode: task dev launches the binary with the repo
// root as cwd, but a real installed build has no source tree to jump to
// at all -- see CapabilitiesService.RepoPath's own doc comment.
const isDevBuild = import.meta.env.DEV

function viewFor(capability: Capability): View {
  switch (capability.View) {
    case ViewKind.ViewRunbook:
      return { kind: 'runbook' }
    case ViewKind.ViewActivity:
      return { kind: 'activity' }
    default:
      return { kind: 'placeholder', capabilityId: capability.ID }
  }
}

// The clickable status directory this whole capability sits on top of
// (docs/SPEC.md §2.2): real React buttons driven by CapabilitiesService's
// data, not links parsed out of the rendered markdown below it.
function CapabilityIndex() {
  const capabilities = useAppStore((s) => s.capabilities)
  const setView = useAppStore((s) => s.setView)

  if (capabilities.length === 0) return null

  const openInEditor = (editorPath: string) => {
    CapabilitiesService.RepoPath()
      .then((repoPath) => Browser.OpenURL(`vscode://file/${repoPath}/${editorPath}`))
      .catch(console.error)
  }

  return (
    <div className={styles.card} data-testid="capability-index">
      <Heading as="h2" variant="small">Capabilities</Heading>
      <Stack direction="vertical" gap="condensed">
        {capabilities.map((c) => (
          <Stack key={c.ID} direction="horizontal" justify="space-between" align="center" gap="normal" data-testid="capability-row">
            <Stack direction="horizontal" gap="condensed" align="center">
              <Label variant={STATUS_VARIANT[c.Status] ?? 'secondary'} size="small">{c.Status}</Label>
              <Text size="small">{c.Label}</Text>
            </Stack>
            <Stack direction="horizontal" gap="condensed">
              <Button size="small" variant="invisible" onClick={() => setView(viewFor(c))}>
                {c.View === ViewKind.ViewPlaceholder ? 'View status' : 'Go to page'}
              </Button>
              {isDevBuild && c.EditorPath && (
                <Button size="small" variant="invisible" onClick={() => openInEditor(c.EditorPath)}>
                  Open in editor
                </Button>
              )}
            </Stack>
          </Stack>
        ))}
      </Stack>
    </div>
  )
}

export default CapabilityIndex
