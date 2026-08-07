import { Heading, SegmentedControl, Text, useTheme } from '@primer/react'
import { SunIcon, MoonIcon, DeviceDesktopIcon } from '@primer/octicons-react'
import styles from './ListCard.module.css'

const COLOR_MODES = ['light', 'dark', 'auto'] as const

// A dedicated Settings page, reached via the sidebar's own bottom-
// anchored footer icon (App.tsx) rather than a NavList entry alongside
// the capability rows -- Notion/Slack's own pattern for app-level
// config vs. content destinations, matching docs/SPEC.md §3.5's
// "Sidebar restructuring" bullet. Moved here from App.tsx's bottom bar,
// which the theme control previously shared with the version/clock/docs
// link -- giving Settings a real page instead of a cramped footer
// control also leaves room to grow (more app-level preferences land
// here, not back in the footer). Persisting the choice and mirroring it
// onto <html> stays in App.tsx (global app-shell behavior that must run
// regardless of whether this page is even mounted), not duplicated here
// -- this component only renders the control, via Primer's own shared
// useTheme() context (same ThemeProvider ancestor App.tsx reads from).
function SettingsView() {
  const { colorMode, setColorMode } = useTheme()

  return (
    <div className={styles.page} data-testid="settings-view">
      <Heading as="h1">Settings</Heading>
      <Text as="p" className={styles.subtitle}>
        App-level preferences -- not workflow or Configure-authored data (that lives in Composition/Configure), a
        UI preference persisted locally to this machine.
      </Text>

      <Heading as="h2" variant="small" className={styles.sectionHeading}>Appearance</Heading>
      <SegmentedControl aria-label="Color theme" onChange={(i) => setColorMode(COLOR_MODES[i])}>
        <SegmentedControl.IconButton icon={SunIcon} aria-label="Light theme" selected={colorMode === 'light'} />
        <SegmentedControl.IconButton icon={MoonIcon} aria-label="Dark theme" selected={colorMode === 'dark'} />
        <SegmentedControl.IconButton icon={DeviceDesktopIcon} aria-label="Match system theme" selected={!colorMode || colorMode === 'auto'} />
      </SegmentedControl>
    </div>
  )
}

export default SettingsView
