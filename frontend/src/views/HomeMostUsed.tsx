import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Text, TextInput } from '@primer/react'
import { GraphIcon } from '@primer/octicons-react'
import { InventoryList } from '../shared/InventoryList'
import { ENTITY_ICON } from '../shared/entityIcons'
import { SettingsService } from '../shared/bindings'
import type { WorkflowUsage } from '../shared/bindings'
import { useAppStore } from '../shared/store'
import { formatMinutes } from './homeFormat'
import listStyles from '../shared/ListCard.module.css'

// The Layer-2 "usage mirror" (docs/goals/0014): every run in range
// counts here regardless of Kind or outcome (WorkflowUsage's own doc
// comment, executionservice_home.go) -- this is "what do I actually
// reach for," a different question from the Time-Saved KPI's strict
// triggered-only accounting. Built on shared/InventoryList
// (.claude/rules/frontend.md: check the kit's list family before
// hand-rolling a collection), the same component every other resource
// inventory in Mill already uses (goal 0007) -- each row's `meta` slot
// carries the inline minutes-saved editor.

// Each row's own live "what this represents" preview -- RunCount (any
// kind/status) × the current minutes-saved estimate. Deliberately NOT
// the same number as the Time Saved KPI card above it (which counts
// only Success + triggered runs, per goal 0014's locked semantics) --
// labeled "at N min/run" rather than "saved" so the two never read as
// contradictory.
function MinutesSavedEditor({ workflowId, minutes, onSaved }: {
  workflowId: string
  minutes: number
  onSaved: (minutes: number) => void
}) {
  const { t } = useTranslation('views')
  const [value, setValue] = useState(String(minutes))
  const [saving, setSaving] = useState(false)

  const commit = () => {
    const parsed = Number(value)
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setValue(String(minutes)) // reject silently back to the last real value
      return
    }
    if (parsed === minutes) return
    setSaving(true)
    SettingsService.SetWorkflowMinutesSaved(workflowId, parsed)
      .then(() => onSaved(parsed))
      .catch(console.error)
      .finally(() => setSaving(false))
  }

  return (
    <TextInput
      type="number"
      min={1}
      size="small"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
      }}
      disabled={saving}
      aria-label={t('home.mostUsed.minutesSavedAriaLabel')}
      data-testid="minutes-saved-input"
      style={{ width: 64 }}
    />
  )
}

export function HomeMostUsed({ usage, minutesByWorkflow, onMinutesChanged }: {
  usage: WorkflowUsage[]
  minutesByWorkflow: Record<string, number>
  onMinutesChanged: (workflowId: string, minutes: number) => void
}) {
  const { t } = useTranslation('views')
  const requestOpenWorkflow = useAppStore((s) => s.requestOpenWorkflow)

  if (usage.length === 0) {
    return (
      <Text as="p" size="small" className={listStyles.muted}>
        {t('home.mostUsed.noRunsInRange')}
      </Text>
    )
  }

  return (
    <InventoryList
      searchPlaceholder={t('home.mostUsed.searchPlaceholder')}
      emptyState={{
        icon: GraphIcon,
        heading: t('home.mostUsed.nothingRanYet'),
        description: t('home.mostUsed.runOrTriggerHint'),
      }}
      items={usage.map((u) => {
        const minutes = minutesByWorkflow[u.workflowID] ?? DEFAULT_MINUTES_FALLBACK
        const total = u.runCount * minutes
        return {
          id: u.workflowID,
          entity: 'workflow',
          icon: ENTITY_ICON.workflow,
          label: u.workflowLabel,
          description: t('home.mostUsed.usageDescription', { count: u.runCount, plural: u.runCount === 1 ? '' : 's', total: formatMinutes(t, total), minutes }),
          onOpen: () => requestOpenWorkflow(u.workflowID),
          menuActions: [],
          meta: (
            <MinutesSavedEditor
              workflowId={u.workflowID}
              minutes={minutes}
              onSaved={(m) => onMinutesChanged(u.workflowID, m)}
            />
          ),
        }
      })}
    />
  )
}

// Mirrors executionsvc.defaultMinutesSavedPerRun /
// settingssvc.defaultWorkflowMinutesSaved -- the frontend's own copy of
// the same small constant, used only until ListWorkflowMinutesSaved's
// real fetch resolves (HomeView.tsx starts minutesByWorkflow at {}).
const DEFAULT_MINUTES_FALLBACK = 3
