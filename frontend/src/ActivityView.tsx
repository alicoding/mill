import { useState } from 'react'
import { Heading, Label, Stack, Text } from '@primer/react'
import { ChevronDownIcon, ChevronRightIcon, CheckCircleIcon, XCircleIcon } from '@primer/octicons-react'
import type { Action } from '../bindings/github.com/alicoding/mill/internal/domain/runbook/models'
import { useAppStore } from './store'
import styles from './RunbookView.module.css'

function actionName(actions: Action[] | null, actionID: string): string {
  return actions?.find((a) => a.ID === actionID)?.Name ?? actionID
}

// A dedicated, always-visible page rather than a section tucked inside
// Runbook: a hotkey fires headlessly with no other UI surface (§2.2), so
// this is the only way to see whether anything fired at all — nested
// inside another page, it was indistinguishable from "the feed doesn't
// work" when nothing had fired yet. Subscribed once at App.tsx (not here)
// so it keeps collecting even while this tab isn't the active view.
function ActivityView() {
  const activity = useAppStore((s) => s.activity)
  const actions = useAppStore((s) => s.actions)
  // Which rows are expanded to show their full result. A Set, not a
  // single id, since comparing two past fires side by side is a
  // reasonable thing to want in a log view.
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div className={`view-pane ${styles.runbook}`}>
      <Heading as="h1">Activity</Heading>
      <Text as="p" className={styles.subtitle}>
        What fired hotkeys actually did, in real time — hotkey triggers run
        headlessly and write straight to the clipboard, with no other
        feedback.
      </Text>

      {activity.length === 0 && (
        <div className={styles.empty}>
          <Text as="p">No activity yet — press a bound hotkey to see it appear here.</Text>
        </div>
      )}

      {activity.length > 0 && (
        <Stack direction="vertical" gap="condensed">
          {activity.map((entry) => {
            const canExpand = entry.result !== ''
            const isExpanded = expanded.has(entry.id)
            return (
              <div key={entry.id} className={styles.activityEntry}>
                <Stack
                  direction="horizontal"
                  align="center"
                  gap="condensed"
                  className={`${styles.activityRow}${canExpand ? ` ${styles.activityRowClickable}` : ''}`}
                  onClick={canExpand ? () => toggle(entry.id) : undefined}
                >
                  {canExpand ? (
                    isExpanded ? <ChevronDownIcon size={12} /> : <ChevronRightIcon size={12} />
                  ) : (
                    <span className={styles.activitySpacer} />
                  )}
                  {entry.success ? (
                    <CheckCircleIcon size={16} fill="var(--fgColor-success)" />
                  ) : (
                    <XCircleIcon size={16} fill="var(--fgColor-danger)" />
                  )}
                  <Text size="small" className={styles.muted}>{entry.time}</Text>
                  <Label variant="secondary" size="small">{entry.binding}</Label>
                  <Text size="small">{actionName(actions, entry.actionID)}</Text>
                  <Text size="small" className={styles.muted}>— {entry.detail}</Text>
                </Stack>
                {isExpanded && canExpand && (
                  <pre className={styles.result}>{entry.result}</pre>
                )}
              </div>
            )
          })}
        </Stack>
      )}
    </div>
  )
}

export default ActivityView
