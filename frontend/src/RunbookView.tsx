import { useEffect, useState } from 'react'
import { Browser } from '@wailsio/runtime'
import { Button, Heading, Label, type LabelProps, SkeletonBox, Stack, Text } from '@primer/react'
import { BeakerIcon, KeyIcon, MarkdownIcon } from '@primer/octicons-react'
import { RunbookService, HotkeyService } from '../bindings/github.com/alicoding/mill'
import { keyFromEventCode, modsFromEvent } from './keybinding'
import { useAppStore } from './store'
import styles from './RunbookView.module.css'

// Per-action leading icon. Falls back to KeyIcon for any future action not
// listed here rather than rendering nothing.
const ACTION_ICONS: Record<string, typeof BeakerIcon> = {
  'load-sample-html': BeakerIcon,
  'clipboard-html-to-markdown': MarkdownIcon,
}

// SPEC.md §2.2's design principle: make it visible which bindings are
// "easy reach" vs "deliberately awkward" so the user can rebalance them,
// rather than just showing the combo with no sense of how easy it is to
// press. Modifier count is a simple, defensible proxy for reach: macOS's
// own awkward-vs-easy example (screenshot vs save-to-file) differs exactly
// on how many modifiers are required.
const MOD_SYMBOLS = ['⌘', '⌃', '⇧', '⌥']

function reachTier(label: string): { text: string; variant: LabelProps['variant'] } {
  const count = [...label].filter((ch) => MOD_SYMBOLS.includes(ch)).length
  if (count <= 1) return { text: 'Easy reach', variant: 'success' }
  if (count === 2) return { text: 'Moderate', variant: 'attention' }
  return { text: 'Deliberately awkward', variant: 'danger' }
}

// SPEC.md §2.2's "Permissions UX pattern" — deep-link straight into the
// exact System Settings pane instead of telling the user to go find it
// themselves, same pattern Hammerspoon/Raycast/1Password use. Verified
// directly against this machine's actual macOS version (26.5.2) rather
// than assumed — these identifiers are unofficial and have broken across
// System Settings rewrites before (see SPEC.md), so re-verify if this
// stops landing on the right pane after a macOS update.
const ACCESSIBILITY_SETTINGS_URL = 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility'

function isAccessibilityError(message: string): boolean {
  return message.includes('Accessibility')
}

function RunbookView() {
  const actions = useAppStore((s) => s.actions)
  const [runningId, setRunningId] = useState<string | null>(null)
  const [results, setResults] = useState<Record<string, string>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [bindings, setBindings] = useState<Record<string, string>>({})
  const [bindingErrors, setBindingErrors] = useState<Record<string, string>>({})
  const [recordingId, setRecordingId] = useState<string | null>(null)

  useEffect(() => {
    HotkeyService.List().then((list) => setBindings((list ?? {}) as Record<string, string>)).catch(console.error)
  }, [])

  useEffect(() => {
    if (!recordingId) return

    const onKeydown = (e: KeyboardEvent) => {
      e.preventDefault()
      if (e.key === 'Escape') {
        setRecordingId(null)
        return
      }
      const key = keyFromEventCode(e.code)
      if (!key) return // modifier-only press, or an unsupported key — keep waiting
      const mods = modsFromEvent(e)
      if (mods.length === 0) return // require at least one modifier

      const actionID = recordingId
      setRecordingId(null)
      setBindingErrors((prev) => ({ ...prev, [actionID]: '' }))
      HotkeyService.Assign(actionID, mods, key)
        .then((label) => setBindings((prev) => ({ ...prev, [actionID]: label })))
        .catch((err) => setBindingErrors((prev) => ({ ...prev, [actionID]: String(err) })))
    }

    window.addEventListener('keydown', onKeydown, true)
    return () => window.removeEventListener('keydown', onKeydown, true)
  }, [recordingId])

  const run = (id: string) => {
    setRunningId(id)
    setErrors((prev) => ({ ...prev, [id]: '' }))
    RunbookService.Run(id)
      .then((output) => setResults((prev) => ({ ...prev, [id]: output })))
      .catch((err) => setErrors((prev) => ({ ...prev, [id]: String(err) })))
      .finally(() => setRunningId(null))
  }

  const clearBinding = (id: string) => {
    HotkeyService.Unassign(id).then(() => {
      setBindings((prev) => {
        const next = { ...prev }
        delete next[id]
        return next
      })
    })
  }

  return (
    <div className={styles.runbook}>
      <Heading as="h1">Runbook</Heading>
      <Text as="p" className={styles.subtitle}>
        Run an action directly, or assign it a global shortcut.
      </Text>

      {actions === null && (
        <Stack direction="vertical" gap="condensed">
          {[0, 1].map((i) => (
            <div key={i} className={styles.card}>
              <SkeletonBox height="1rem" width="40%" className={styles.skeletonLine} />
              <SkeletonBox height="0.8rem" width="80%" />
            </div>
          ))}
        </Stack>
      )}

      {actions !== null && actions.length === 0 && (
        <div className={styles.empty}>
          <Text as="p">No actions available yet.</Text>
        </div>
      )}

      {actions !== null && actions.length > 0 && (
        <Stack direction="vertical" gap="condensed">
          {actions.map((action) => {
            const Icon = ACTION_ICONS[action.ID] ?? KeyIcon
            return (
              <div key={action.ID} className={styles.card} data-testid="runbook-card">
                <Stack direction="horizontal" justify="space-between" align="start" gap="normal">
                  <Stack direction="horizontal" gap="condensed" align="start">
                    <span className={styles.icon}><Icon size={16} /></span>
                    <div>
                      <Heading as="h2" variant="small">{action.Name}</Heading>
                      <Text size="small" className={styles.muted}>{action.Description}</Text>
                    </div>
                  </Stack>

                  <Stack direction="horizontal" align="center" gap="condensed" className={styles.itemControls}>
                    <Button onClick={() => run(action.ID)} disabled={runningId === action.ID} size="small">
                      {runningId === action.ID ? 'Running…' : 'Run'}
                    </Button>

                    {recordingId === action.ID ? (
                      <Text size="small" className={styles.recording}>Press a combo… (Esc to cancel)</Text>
                    ) : bindings[action.ID] ? (
                      <>
                        <Label variant="secondary">
                          <KeyIcon size={12} /> {bindings[action.ID]}
                        </Label>
                        <Label variant={reachTier(bindings[action.ID]).variant} size="small">
                          {reachTier(bindings[action.ID]).text}
                        </Label>
                        <Button size="small" variant="invisible" onClick={() => setRecordingId(action.ID)}>Change</Button>
                        <Button size="small" variant="invisible" onClick={() => clearBinding(action.ID)}>Clear</Button>
                      </>
                    ) : (
                      <Button size="small" variant="invisible" onClick={() => setRecordingId(action.ID)}>
                        Set shortcut
                      </Button>
                    )}
                  </Stack>
                </Stack>

                {bindingErrors[action.ID] && (
                  <Stack direction="vertical" gap="condensed">
                    <Text as="p" size="small" className={styles.error}>{bindingErrors[action.ID]}</Text>
                    {isAccessibilityError(bindingErrors[action.ID]) && (
                      <Button size="small" onClick={() => Browser.OpenURL(ACCESSIBILITY_SETTINGS_URL)}>
                        Open Accessibility Settings
                      </Button>
                    )}
                  </Stack>
                )}
                {errors[action.ID] && (
                  <Text as="p" size="small" className={styles.error}>{errors[action.ID]}</Text>
                )}
                {results[action.ID] !== undefined && !errors[action.ID] && (
                  <pre className={styles.result}>{results[action.ID]}</pre>
                )}
              </div>
            )
          })}
        </Stack>
      )}
    </div>
  )
}

export default RunbookView
