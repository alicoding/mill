import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Dialog, FormControl, IconButton, Stack, Text, TextInput } from '@primer/react'
import { EyeClosedIcon, EyeIcon, ZapIcon } from '@primer/octicons-react'
import { SecretService } from '../shared/bindings'
import styles from './SecretsView.module.css'

// Create/edit form (goal 0185 S2). editID names an existing entry to
// load and edit; opening Edit is an explicit, auditable reveal (the
// only way to load Password/Notes into the form without silently
// wiping them on save) -- same posture as the detail dialog's own
// reveal toggle, just triggered by choosing Edit instead of Show.
export function SecretsEntryDialog({ editID, onClose, onSaved }: {
  editID: string | null
  onClose: () => void
  onSaved: () => void
}) {
  const { t } = useTranslation('secrets')
  const [loaded, setLoaded] = useState(editID === null)
  const [title, setTitle] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [url, setURL] = useState('')
  const [notes, setNotes] = useState('')
  const [tags, setTags] = useState('')
  const [revealed, setRevealed] = useState(editID === null) // a brand-new entry starts revealed -- nothing to hide yet
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (editID === null) return
    SecretService.RevealSecret(editID).then((e) => {
      setTitle(e.Title); setUsername(e.Username); setPassword(e.Password)
      setURL(e.URL); setNotes(e.Notes); setTags(e.Tags)
      setLoaded(true)
    }).catch((err) => { setError(String(err)); setLoaded(true) })
  }, [editID])

  const generate = () => {
    SecretService.GeneratePassword(20, true, true, true, false)
      .then((p) => { setPassword(p); setRevealed(true) })
      .catch((err) => setError(String(err)))
  }

  const save = async () => {
    if (title.trim() === '') {
      setError(t('titleRequired'))
      return
    }
    setSaving(true)
    setError('')
    try {
      if (editID) {
        await SecretService.UpdateSecret(editID, title, username, password, url, notes, tags)
      } else {
        await SecretService.CreateSecret(title, username, password, url, notes, tags)
      }
      onSaved()
    } catch (err) {
      setError(String(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog
      title={editID ? title || t('editButton') : t('newSecret')}
      onClose={onClose}
      footerButtons={[
        { content: t('cancel'), onClick: onClose },
        { content: t('save'), buttonType: 'primary', onClick: () => void save(), disabled: saving || !loaded },
      ]}
    >
      {!loaded ? null : (
        <Stack direction="vertical" gap="condensed">
          <FormControl>
            <FormControl.Label>{t('fields.title')}</FormControl.Label>
            <TextInput value={title} onChange={(e) => setTitle(e.target.value)} block autoFocus data-testid="secret-title-input" />
          </FormControl>
          <FormControl>
            <FormControl.Label>{t('fields.username')}</FormControl.Label>
            <TextInput value={username} onChange={(e) => setUsername(e.target.value)} block data-testid="secret-username-input" />
          </FormControl>
          <FormControl>
            <FormControl.Label>{t('fields.password')}</FormControl.Label>
            <Stack direction="horizontal" gap="condensed" align="center">
              <TextInput
                type={revealed ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                block
                data-testid="secret-password-input"
                trailingAction={(
                  <TextInput.Action
                    icon={revealed ? EyeClosedIcon : EyeIcon}
                    aria-label={revealed ? t('hide') : t('reveal')}
                    onClick={() => setRevealed((r) => !r)}
                  />
                )}
              />
              <IconButton icon={ZapIcon} aria-label={t('generateAriaLabel')} size="small" variant="invisible" onClick={generate} data-testid="secret-generate" />
            </Stack>
          </FormControl>
          <FormControl>
            <FormControl.Label>{t('fields.url')}</FormControl.Label>
            <TextInput value={url} onChange={(e) => setURL(e.target.value)} block data-testid="secret-url-input" />
          </FormControl>
          <FormControl>
            <FormControl.Label>{t('fields.notes')}</FormControl.Label>
            <TextInput value={notes} onChange={(e) => setNotes(e.target.value)} block data-testid="secret-notes-input" />
          </FormControl>
          <FormControl>
            <FormControl.Label>{t('fields.tags')}</FormControl.Label>
            <TextInput value={tags} onChange={(e) => setTags(e.target.value)} block data-testid="secret-tags-input" />
          </FormControl>
          {error && <Text as="p" size="small" className={styles.error} data-testid="secret-form-error">{error}</Text>}
        </Stack>
      )}
    </Dialog>
  )
}
