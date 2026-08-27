import { useTranslation } from 'react-i18next'
import { NavList } from '@primer/react'
import type { DocsGroup } from './docsGroups'
import styles from './DocsView.module.css'

interface DocsNavProps {
  groups: DocsGroup[]
  currentPage: string
  onSelect: (rel: string) => void
}

// The grouped sidebar (goal 0235 S1): each userdocs/ directory becomes
// a collapsible NavList.Item + NavList.SubNav pair -- Primer's own
// accordion shape (NavList.Item's `defaultOpen`, confirmed against the
// installed .d.ts) rather than NavList.Group, which the installed
// version renders always-expanded with no collapse affordance.
export default function DocsNav({ groups, currentPage, onSelect }: DocsNavProps) {
  const { t } = useTranslation('views')
  return (
    <nav className={styles.nav} aria-label={t('docs.navAriaLabel')} data-testid="docs-nav">
      <NavList>
        {groups.map((group) => {
          const isCurrentSection = group.entries.some((e) => e.rel === currentPage)
          return (
            // NavList.Item drops unknown props (data-testid included)
            // once it detects a NavList.SubNav child and switches to
            // the accordion-header render path -- e2e locates this
            // element by its visible section title text instead.
            <NavList.Item
              key={group.dir}
              defaultOpen={isCurrentSection}
            >
              {group.titleKey ? t(group.titleKey) : group.dir}
              <NavList.SubNav>
                {group.entries.map((entry) => (
                  <NavList.Item
                    key={entry.rel}
                    href="#"
                    aria-current={entry.rel === currentPage ? 'page' : undefined}
                    onClick={(ev) => {
                      ev.preventDefault()
                      onSelect(entry.rel)
                    }}
                    data-testid="docs-nav-item"
                  >
                    {entry.title}
                  </NavList.Item>
                ))}
              </NavList.SubNav>
            </NavList.Item>
          )
        })}
      </NavList>
    </nav>
  )
}
