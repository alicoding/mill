import { useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Heading } from '@primer/react'
import PageContainer from '../shared/PageContainer'
import { useIsNarrowViewport } from '../shared/useNarrowViewport'
import { CONFIGURE_KINDS, resolveConfigureKind, type ConfigureKindID } from '../shared/configureKinds'
import { ConfigureRequests } from './ConfigureRequests'
import { ConfigureClientCerts } from './ConfigureClientCerts'
import { ConfigureLists } from './ConfigureLists'
import { ConfigureAttributes } from './ConfigureAttributes'
import { ConfigureMCPServers } from './ConfigureMCPServers'
import { ConfigureDecisions } from './ConfigureDecisions'
import { ConfigureEnvironments } from './ConfigureEnvironments'
import { ConfigureExecEnv } from './ConfigureExecEnv'
import { ConfigureConversionProfiles } from './ConfigureConversionProfiles'
import { ConfigureAIProviders } from './ConfigureAIProviders'
import { ConfigureStepTypes } from './ConfigureStepTypes'
import ConfigureKindNav from './ConfigureKindNav'
import { clearConfigureHash, kindFromHash, readLastConfigureKind, rememberConfigureKind, writeConfigureHash } from './configureRoute'
import rail from '../shared/RailLayout.module.css'
import styles from './ConfigureView.module.css'
import listStyles from '../shared/ListCard.module.css'

// The Configure surface (docs/SPEC.md §3.5): one pane per registered
// kind (shared/configureKinds.ts), navigated by a grouped rail with a
// filter -- the same routed two-pane shell Settings renders through
// (views/SettingsView.tsx, goal 0321). The route is
// `#/configure/<kind>` (configureRoute.ts).
//
// A pane mounts the first time its kind is selected and stays mounted
// (hidden) afterwards, so switching kinds never loses in-progress form
// state in a pane already visited -- and a kind never visited costs
// nothing: no requests, no DOM.
//
// initialTab: an incoming deep link (a palette `configure.open.<kind>`
// or `configure.new.<kind>` command, the Quick Panel's jump rows, a
// reloaded `#/configure/<kind>` URL) wins over the per-device memory of
// the last kind read for that visit. App.tsx's `key={view.tab}` forces
// a fresh mount on a changed tab; the effect below covers a second
// arrival on the same tab.
const PANES: Record<ConfigureKindID, () => ReactNode> = {
  integration: () => <ConfigureRequests />,
  mcpservers: () => <ConfigureMCPServers />,
  aiproviders: () => <ConfigureAIProviders />,
  certificates: () => <ConfigureClientCerts />,
  environments: () => <ConfigureEnvironments />,
  execenvs: () => <ConfigureExecEnv />,
  lists: () => <ConfigureLists />,
  attributes: () => <ConfigureAttributes />,
  conversionprofiles: () => <ConfigureConversionProfiles />,
  decisions: () => <ConfigureDecisions />,
  steptypes: () => <ConfigureStepTypes />,
}

function ConfigureView({ initialTab }: { initialTab?: string }) {
  const { t } = useTranslation('configure')
  const isNarrowViewport = useIsNarrowViewport()

  const [kind, setKind] = useState<ConfigureKindID>(() => {
    if (initialTab) return resolveConfigureKind(initialTab)
    return kindFromHash(window.location.hash) ?? readLastConfigureKind()
  })
  useEffect(() => {
    if (initialTab) setKind(resolveConfigureKind(initialTab))
  }, [initialTab])

  // The route follows the pane, never the reverse: replaceState so the
  // back gesture leaves Configure rather than walking its kinds, and
  // the hash is cleared on unmount so navigating elsewhere doesn't
  // leave a stale Configure address behind.
  useEffect(() => {
    writeConfigureHash(kind)
    rememberConfigureKind(kind)
  }, [kind])
  useEffect(() => clearConfigureHash, [])

  // Every kind selected so far this mount, so a visited pane keeps
  // its state while hidden. The active kind renders even before the
  // effect records it -- no blank frame on first selection.
  const [visited, setVisited] = useState<ConfigureKindID[]>([])
  useEffect(() => {
    setVisited((prev) => (prev.includes(kind) ? prev : [...prev, kind]))
  }, [kind])
  const mounted = visited.includes(kind) ? visited : [...visited, kind]

  const select = useCallback((next: ConfigureKindID) => setKind(next), [])

  return (
    <>
      <PageContainer>
        <Heading as="h1" variant="medium" className={listStyles.subtitle}>
          {t('configureView.subtitle')}
        </Heading>
      </PageContainer>
      <div className={isNarrowViewport ? `${rail.layoutNarrow} ${styles.layoutNarrow}` : `${rail.layout} ${styles.layout}`} data-testid="configure-view">
        <ConfigureKindNav activeId={kind} onSelect={select} />
        <div className={styles.pane}>
          {CONFIGURE_KINDS.filter((k) => mounted.includes(k.id)).map((k) => (
            <div key={k.id} hidden={k.id !== kind} data-testid={`configure-pane-${k.id}`}>
              {PANES[k.id]()}
            </div>
          ))}
        </div>
      </div>
    </>
  )
}

export default ConfigureView
