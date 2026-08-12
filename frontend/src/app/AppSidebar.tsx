import { useTranslation } from 'react-i18next'
import { CounterLabel, IconButton, NavList, PageLayout, Text } from '@primer/react'
import { DotFillIcon, GearIcon, SidebarCollapseIcon, SidebarExpandIcon } from '@primer/octicons-react'
import { viewFor, viewsEqual, statusDotColor } from '../shared/store'
import type { View } from '../shared/store'
import type { Capability } from '../../bindings/github.com/alicoding/mill/internal/domain/capabilities/models'
import { CAPABILITY_ICON } from './navIcon'
import millIcon from './millicon.png'
import styles from './App.module.css'

// The app sidebar: identity anchor top row (logo never moves between
// states -- owner design, matched against the reference platform's own
// sidebar), capability nav, and the settings footer. Extracted from
// App.tsx along this seam when the identity-anchor work pushed it over
// the 500-line limit (.claude/rules/architecture.md).
export function AppSidebar({ sidebarOpen, setSidebarOpen, view, setView, capabilities, reviewPendingCount }: {
  sidebarOpen: boolean
  setSidebarOpen: (open: boolean) => void
  view: View
  setView: (v: View) => void
  capabilities: Capability[]
  reviewPendingCount: number
}) {
  const { t } = useTranslation('app')
  return (
        <PageLayout.Sidebar
          className={styles.sidebar}
          width="small"
          responsiveVariant="default"
          divider="line"
          padding="condensed"
        >
          {/* The wordmark + collapse toggle that used to render here (a
              .sidebarHeader row) moved up into the titlebar band's own
              left segment above -- the fix for the reported flaw (they
              used to sit orphaned below the band, and collapsing the
              sidebar moved nothing up there). .sidebarNav is now the
              sidebar's first real content. */}
          {/* The sidebar's own top row, above Home (owner design,
              2026-08-11): expanded, the collapse toggle sits far left
              -- the control lives next to the nav it controls.
              Collapsed, the same slot is the Mill icon (the app's real
              appicon) that swaps to the expand control on hover/focus
              -- the Discord/Notion rail pattern: the rail
              self-identifies, and the control appears exactly when
              you reach for it. One always-present IconButton either
              way, so keyboard focus works identically in both states. */}
          <div className={styles.sidebarTopRow}>
            {sidebarOpen ? (
              <>
                {/* Owner refinement (final form): expanded shows the
                    WORDMARK alone far left (the icon reads badly at
                    this size beside text -- collapsed keeps the icon,
                    same anchor slot), and the collapse control sits at
                    the row's FAR RIGHT, aligned with the nav rows'
                    status-dot column. */}
                <span className={styles.sidebarIdentity}>
                  <Text className={styles.sidebarWordmark}>{t('appSidebar.wordmark')}</Text>
                </span>
                <IconButton
                  icon={SidebarCollapseIcon}
                  aria-label={t('appSidebar.collapseNavigation')}
                  size="small"
                  variant="invisible"
                  onClick={() => setSidebarOpen(false)}
                />
              </>
            ) : (
              <button
                type="button"
                aria-label={t('appSidebar.expandNavigation')}
                className={styles.railLogoButton}
                onClick={() => setSidebarOpen(true)}
              >
                <img src={millIcon} alt="" className={styles.railLogo} />
                <span className={styles.railLogoHover} aria-hidden="true"><SidebarExpandIcon size={16} /></span>
              </button>
            )}
          </div>
          <div className={styles.sidebarNav} data-testid="sidebar-nav">
            <NavList>
              {capabilities.map((c) => {
                const target = viewFor(c);
                const label = c.NavLabel || c.Label;
                const NavIcon = CAPABILITY_ICON[c.ID];
                return (
                  <NavList.Item
                    key={c.ID}
                    href="#"
                    aria-current={viewsEqual(view, target) ? 'page' : undefined}
                    aria-label={sidebarOpen ? undefined : label}
                    title={sidebarOpen ? undefined : label}
                    onClick={(e) => { e.preventDefault(); setView(target) }}
                  >
                    {NavIcon && <NavList.LeadingVisual><NavIcon/></NavList.LeadingVisual>}
                    {sidebarOpen && label}
                    {sidebarOpen && (
                      <NavList.TrailingVisual>
                        {c.ID === 'capability-review' && reviewPendingCount > 0 && (
                          <CounterLabel
                            data-testid="review-pending-count"
                            aria-label={t('reviewPendingAriaLabel', { count: reviewPendingCount })}
                          >
                            {reviewPendingCount}
                          </CounterLabel>
                        )}
                        <span title={c.Status} className={styles.statusDot}>
                          <DotFillIcon
                            size={12}
                            fill={statusDotColor(c.Status)}
                            aria-label={c.Status}
                          />
                        </span>
                      </NavList.TrailingVisual>
                    )}
                  </NavList.Item>
                );
              })}
            </NavList>
          </div>

          {/* Settings pulled out of the NavList entirely, into a bottom-
              anchored footer slot -- Notion/Slack's own pattern for
              app-level config vs. content destinations (docs/SPEC.md
              §3.5). Not a capability (no build status/SPEC section of
              its own), so it isn't driven by CapabilitiesService.List()
              the way the rows above are -- a fixed control. */}
          <div className={styles.sidebarFooter}>
            <IconButton
              icon={GearIcon}
              aria-label={t('appSidebar.settingsAriaLabel')}
              size="small"
              variant="invisible"
              onClick={() => setView({ kind: 'settings' })}
            />
          </div>
        </PageLayout.Sidebar>
  )
}
