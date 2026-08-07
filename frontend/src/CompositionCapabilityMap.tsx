import { useEffect, useState } from 'react'
import { Heading, Label, type LabelProps, Stack, Text } from '@primer/react'
import { ChevronDownIcon, ChevronRightIcon } from '@primer/octicons-react'
import { CompositionService } from '../bindings/github.com/alicoding/mill'
import { Approach, type MapEntry } from '../bindings/github.com/alicoding/mill/internal/domain/composition/models'
import { statusVariant } from './store'
import styles from './ListCard.module.css'

const APPROACH_LABEL: Record<Approach, string> = {
  [Approach.ApproachAdopt]: 'adopt',
  [Approach.ApproachBuild]: 'build',
  [Approach.ApproachMixed]: 'mixed',
  [Approach.$zero]: '',
}

const APPROACH_VARIANT: Record<Approach, LabelProps['variant']> = {
  [Approach.ApproachAdopt]: 'success',
  [Approach.ApproachBuild]: 'severe',
  [Approach.ApproachMixed]: 'accent',
  [Approach.$zero]: 'secondary',
}

// Real Go data (CompositionService.CapabilityMap, backed by
// internal/domain/composition.CapabilityMap) projecting docs/SPEC.md
// §3.3's capability map into the Spec tab -- the same "authoritative
// machine-read data, not parsed markdown" relationship CapabilityIndex
// already has to page-level capabilities, applied one level down for
// composition's own sub-capabilities (Trigger, Decision, Parallel
// Steps...). Built specifically so the adopt-vs-build/schema decision
// for §3 gets made against the full known need, visible in the app
// itself, before any backend (DBOS, the Node/Edge schema) is built.
function CompositionCapabilityMap() {
  const [entries, setEntries] = useState<MapEntry[] | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  useEffect(() => {
    CompositionService.CapabilityMap().then((list) => setEntries(list ?? [])).catch(console.error)
  }, [])

  if (entries === null || entries.length === 0) return null

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div className={styles.card} data-testid="composition-capability-map">
      <Heading as="h2" variant="small">Composition capability map</Heading>
      <Text as="p" size="small" className={styles.muted}>
        Every known composition capability, adopt-or-build and current status —
        docs/SPEC.md §3.3. Not all built; captured so the schema gets designed
        against the full need, not just today's two workflows.
      </Text>
      <Stack direction="vertical" gap="condensed">
        {entries.map((entry) => {
          const isExpanded = expanded.has(entry.ID)
          return (
            <div key={entry.ID} className={styles.activityEntry} data-testid="capability-map-row">
              <Stack
                direction="horizontal"
                align="center"
                gap="condensed"
                className={`${styles.activityRow} ${styles.activityRowClickable}`}
                onClick={() => toggle(entry.ID)}
              >
                {isExpanded ? <ChevronDownIcon size={12} /> : <ChevronRightIcon size={12} />}
                <Text size="small" weight="semibold">{entry.Name}</Text>
                <Label variant={APPROACH_VARIANT[entry.Approach]} size="small">{APPROACH_LABEL[entry.Approach]}</Label>
                <Label variant={statusVariant(entry.Status)} size="small">{entry.Status}</Label>
              </Stack>
              {isExpanded && (
                <Stack direction="vertical" gap="condensed" className={styles.stepConfigField}>
                  <Text as="p" size="small">{entry.WhatItDoes}</Text>
                  <Text as="p" size="small" className={styles.muted}>{entry.ApproachDetail}</Text>
                  <Text as="p" size="small" className={styles.muted}>{entry.StatusDetail}</Text>
                </Stack>
              )}
            </div>
          )
        })}
      </Stack>
    </div>
  )
}

export default CompositionCapabilityMap
