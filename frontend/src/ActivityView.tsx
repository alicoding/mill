import { Heading, Label, Stack, Text } from '@primer/react'
import { CheckCircleIcon, XCircleIcon } from '@primer/octicons-react'
import type { HotkeyActivity } from '../bindings/github.com/alicoding/mill/models'
import type { Action } from '../bindings/github.com/alicoding/mill/internal/domain/runbook/models'

export type ActivityEntry = HotkeyActivity & { id: string; time: string }

interface ActivityViewProps {
  activity: ActivityEntry[]
  actions: Action[] | null
}

function actionName(actions: Action[] | null, actionID: string): string {
  return actions?.find((a) => a.ID === actionID)?.Name ?? actionID
}

// A dedicated, always-visible page rather than a section tucked inside
// Runbook: a hotkey fires headlessly with no other UI surface (§2.2), so
// this is the only way to see whether anything fired at all — nested
// inside another page, it was indistinguishable from "the feed doesn't
// work" when nothing had fired yet. Subscribed once at App.tsx (not here)
// so it keeps collecting even while this tab isn't the active view.
function ActivityView({ activity, actions }: ActivityViewProps) {
  return (
    <div className="runbook">
      <Heading as="h1">Activity</Heading>
      <Text as="p" className="runbook-subtitle">
        What fired hotkeys actually did, in real time — hotkey triggers run
        headlessly and write straight to the clipboard, with no other
        feedback.
      </Text>

      {activity.length === 0 && (
        <div className="runbook-empty">
          <Text as="p">No activity yet — press a bound hotkey to see it appear here.</Text>
        </div>
      )}

      {activity.length > 0 && (
        <Stack direction="vertical" gap="condensed">
          {activity.map((entry) => (
            <Stack key={entry.id} direction="horizontal" align="center" gap="condensed" className="runbook-activity-row">
              {entry.success ? (
                <CheckCircleIcon size={16} fill="var(--fgColor-success)" />
              ) : (
                <XCircleIcon size={16} fill="var(--fgColor-danger)" />
              )}
              <Text size="small" className="runbook-muted">{entry.time}</Text>
              <Label variant="secondary" size="small">{entry.binding}</Label>
              <Text size="small">{actionName(actions, entry.actionID)}</Text>
              <Text size="small" className="runbook-muted">— {entry.detail}</Text>
            </Stack>
          ))}
        </Stack>
      )}
    </div>
  )
}

export default ActivityView
