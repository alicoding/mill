import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Dialog, Text } from '@primer/react'
import { SettingsService } from './bindings'
import { background } from './background'

// The first-run intro surface (goal 0202): a NAMED reusable overlay
// for a capability whose landing screen alone can't carry its own
// explanation -- the converged welcome-dialog pattern, adopted whole
// from Primer's Dialog (backdrop, focus trap, Escape and close-button
// dismissal are the kit's). A surface mounts
// `<FirstRunIntro id="..." title body />` and the intro shows itself
// exactly once per user, ever: EVERY dismissal path records the id
// server-side (SettingsService, so "already seen" survives server
// mode and a second device), and nothing renders until that seen
// list has actually loaded -- a dialog that flashes and vanishes is
// worse than one that arrives a beat late.
//
// Deliberately not a tour: Primer ships no coach-mark/spotlight
// machinery, and no consumer needs per-element steps -- revisit if
// one ever does. The id namespace is the consumer's own choice;
// nothing here knows any consumer exists.
export function FirstRunIntro({ id, title, body, testId }: {
  id: string
  title: string
  // One-to-few short paragraphs, pre-localized by the consumer.
  body: readonly string[]
  testId?: string
}) {
  const { t } = useTranslation('views')
  const [seen, setSeen] = useState<boolean | null>(null)

  useEffect(() => {
    let stale = false
    SettingsService.GetSeenFirstRunIntros()
      .then((ids) => {
        if (!stale) setSeen((ids ?? []).includes(id))
      })
      .catch(() => {
        // An unreadable seen list shows nothing rather than risking a
        // repeat nag -- the intro is guidance, never load-bearing.
        if (!stale) setSeen(true)
      })
    return () => {
      stale = true
    }
  }, [id])

  if (seen !== false) return null

  const dismiss = () => {
    setSeen(true)
    void background(SettingsService.MarkFirstRunIntroSeen(id), 'firstRunIntro.markFirstRunIntroSeen')
  }

  return (
    <Dialog
      title={title}
      onClose={dismiss}
      width="large"
      footerButtons={[{ content: t('firstRunIntro.gotIt'), buttonType: 'primary', onClick: dismiss, autoFocus: true }]}
      data-testid={testId ?? `first-run-intro-${id}`}
    >
      {body.map((paragraph, i) => (
        <Text as="p" key={i} size="medium">
          {paragraph}
        </Text>
      ))}
    </Dialog>
  )
}
