import { useTranslation } from 'react-i18next'
import { IconButton } from '@primer/react'
import { ThreeBarsIcon } from '@primer/octicons-react'
import styles from './App.module.css'

// The titlebar band's mobile nav-drawer opener (goal 0068). CSS-only
// visible below 768px (App.module.css's .mobileNavToggle), where
// everything else in the band's left segment hides -- the phone's nav
// entry point, since the sidebar itself starts hidden there
// (AppSidebar's hidden={{narrow: !mobileNavOpen}}). Extracted out of
// App.tsx's own titlebar JSX purely to keep that file under the
// 500-line limit (architecture.md).
export function MobileNavToggle({ onOpen }: { onOpen: () => void }) {
  const { t } = useTranslation('app')
  return (
    <IconButton
      icon={ThreeBarsIcon}
      aria-label={t('appSidebar.openNavigation')}
      size="small"
      variant="invisible"
      className={styles.mobileNavToggle}
      onClick={onOpen}
      data-testid="mobile-nav-toggle"
    />
  )
}
