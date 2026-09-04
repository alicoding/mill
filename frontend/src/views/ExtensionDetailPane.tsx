import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { ActionList, ActionMenu, Button, Heading, IconButton, Label, Link, Stack, Text } from '@primer/react'
import { ChevronLeftIcon, KebabHorizontalIcon, type Icon } from '@primer/octicons-react'
import type { ExtensionSettingDecl } from '../atlas/atlasNounRegistry'
import { useAppStore } from '../shared/store'
import { ConfirmDialog } from '../shared/ConfirmDialog'
import { ExtensionSettingControl } from './ExtensionSettingControl'
import listStyles from '../shared/ListCard.module.css'
import styles from './ExtensionsSection.module.css'

// Every canvas tool is an Atlas object -- one Docs link fits every
// extension, never a per-tool URL guess.
const ATLAS_CONCEPTS_DOCS_PAGE = 'concepts/atlas.md'

// The kinds of contribution an extension can declare, in the order
// "What it adds" lists them. Each maps to one copy key.
export type ExtensionAddKind = 'commands' | 'objects' | 'steps' | 'views' | 'captures'
const ADD_COPY_KEY: Record<ExtensionAddKind, string> = {
  commands: 'settings.extensions.addsCommands',
  objects: 'settings.extensions.addsObjects',
  steps: 'settings.extensions.addsSteps',
  views: 'settings.extensions.addsViews',
  captures: 'settings.extensions.addsCaptures',
}

// One normalized detail, built by whichever list the row came from --
// the pane itself never branches on built-in vs installed plugin.
export interface ExtensionDetail {
  id: string
  icon: Icon
  name: string
  // "v1.2.0 · Acme" for a plugin; empty for a built-in noun, whose
  // version is the app's own and is stated on the provenance line.
  metaLine?: string
  description: string
  chips: string[]
  disableScopeNote?: string
  settings: readonly ExtensionSettingDecl[]
  adds: { kind: ExtensionAddKind; items: string[] }[]
  reach: string
  // What this extension claims to CATCH -- dropped file extensions,
  // pasted links -- stated beside the reach line so both declarations
  // read together.
  claims?: string[]
  // "Ships with Mill v1.2.0" or "From /Users/…/plugins/acme". Omitted
  // when the header's own meta line already says where this came from
  // -- a bundled plugin would otherwise read "Built into Mill" twice.
  provenance?: string
  // Whatever the row's own state needs said in full: an error, a
  // policy block, the awaiting-review strip with its Allow button.
  status?: ReactNode
  // Row-specific actions in the header (an installed plugin's Reload).
  actions?: ReactNode
  // Present only for a removable plugin; the pane renders it behind
  // the … menu, never as a bare button beside the toggle.
  onRemove?: () => void
}

// The Extensions detail pane (goal 0321): everything a row used to
// unfold inline, in one place that stays put while the list is
// scanned. At the two-pane breakpoint it sits beside the list; below
// it, the caller renders it INSTEAD of the list and this component's
// own back link returns.
//
// Escape closes it and focus returns to the row that opened it: the
// pane takes focus on mount (it is what the click produced), so a
// keyboard user is not left behind in the list with an unread pane.
export function ExtensionDetailPane({ detail, showBackLink, onClose }: {
  detail: ExtensionDetail
  showBackLink: boolean
  onClose: () => void
}) {
  const { t } = useTranslation('views')
  const paneRef = useRef<HTMLDivElement>(null)
  const [confirmingRemove, setConfirmingRemove] = useState(false)

  useEffect(() => {
    paneRef.current?.focus()
  }, [detail.id])

  return (
    <div
      className={styles.detail}
      ref={paneRef}
      tabIndex={-1}
      role="region"
      aria-label={t('settings.extensions.detailAriaLabel', { name: detail.name })}
      data-testid="extensions-detail"
      data-extension-id={detail.id}
      onKeyDown={(e) => {
        if (e.key !== 'Escape' || confirmingRemove) return
        e.stopPropagation()
        onClose()
      }}
    >
      {showBackLink && (
        <Button
          variant="invisible"
          size="small"
          leadingVisual={ChevronLeftIcon}
          onClick={onClose}
          data-testid="extensions-detail-back"
        >
          {t('settings.extensions.backToList')}
        </Button>
      )}
      <Stack direction="horizontal" justify="space-between" align="start" gap="condensed">
        <Stack direction="horizontal" gap="condensed" align="center">
          <detail.icon size={16} />
          <Stack direction="vertical" gap="none">
            <Heading as="h3" variant="small">{detail.name}</Heading>
            {detail.metaLine && (
              <Text size="small" className={listStyles.muted} data-testid="extensions-detail-meta">{detail.metaLine}</Text>
            )}
          </Stack>
        </Stack>
        <Stack direction="horizontal" gap="condensed" align="center">
          {detail.actions}
          {detail.onRemove && (
            <ActionMenu>
              <ActionMenu.Anchor>
                <IconButton
                  icon={KebabHorizontalIcon}
                  size="small"
                  variant="invisible"
                  aria-label={t('settings.extensions.moreActions', { name: detail.name })}
                  data-testid="extensions-detail-menu"
                />
              </ActionMenu.Anchor>
              <ActionMenu.Overlay>
                <ActionList>
                  <ActionList.Item variant="danger" onSelect={() => setConfirmingRemove(true)} data-testid="extensions-detail-remove">
                    {t('settings.extensions.remove')}
                  </ActionList.Item>
                </ActionList>
              </ActionMenu.Overlay>
            </ActionMenu>
          )}
        </Stack>
      </Stack>

      <Text as="p" size="small" data-testid="extensions-detail-description">{detail.description}</Text>

      {detail.chips.length > 0 && (
        /* A plain wrapping row, not a Stack: Primer's Stack pins
           flex-wrap and the chip set is wider than this pane. */
        <div className={styles.chips}>
          {detail.chips.map((chip) => <Label key={chip}>{chip}</Label>)}
        </div>
      )}

      {detail.status}

      {detail.disableScopeNote && (
        <Text as="p" size="small" className={listStyles.muted} data-testid="extensions-detail-disable-scope">
          {detail.disableScopeNote}
        </Text>
      )}

      {detail.settings.length > 0 && (
        <Stack direction="vertical" gap="condensed" data-testid="extensions-detail-settings">
          {detail.settings.map((setting) => (
            <ExtensionSettingControl key={setting.key} extensionId={detail.id} setting={setting} />
          ))}
        </Stack>
      )}

      <Stack direction="vertical" gap="none" data-testid="extensions-detail-adds">
        <Text as="p" size="small" weight="semibold">{t('settings.extensions.whatItAdds')}</Text>
        {detail.adds.length === 0 ? (
          <Text as="p" size="small" className={listStyles.muted}>{t('settings.extensions.addsNothing')}</Text>
        ) : (
          detail.adds.map((add) => (
            <Text as="p" size="small" className={listStyles.muted} key={add.kind}>
              {t(ADD_COPY_KEY[add.kind], { list: add.items.join(', ') })}
            </Text>
          ))
        )}
      </Stack>

      <Text as="p" size="small" className={listStyles.muted} data-testid="extensions-detail-reach">{detail.reach}</Text>
      {detail.claims?.map((claim) => (
        <Text as="p" size="small" className={listStyles.muted} key={claim} data-testid="extensions-detail-claim">{claim}</Text>
      ))}
      {detail.provenance && (
        <Text as="p" size="small" className={listStyles.muted} data-testid="extensions-detail-provenance">{detail.provenance}</Text>
      )}
      <Link
        href="#"
        onClick={(e) => {
          e.preventDefault()
          useAppStore.getState().setView({ kind: 'docs', page: ATLAS_CONCEPTS_DOCS_PAGE })
        }}
        data-testid="extensions-detail-docs"
      >
        {t('settings.extensions.docs')}
      </Link>

      {confirmingRemove && detail.onRemove && (
        <ConfirmDialog
          title={t('settings.extensions.removeConfirmTitle', { name: detail.name })}
          body={t('settings.extensions.removeConfirmBody')}
          confirmLabel={t('settings.extensions.removeConfirmButton')}
          onCancel={() => setConfirmingRemove(false)}
          onConfirm={() => {
            setConfirmingRemove(false)
            detail.onRemove?.()
          }}
        />
      )}
    </div>
  )
}
