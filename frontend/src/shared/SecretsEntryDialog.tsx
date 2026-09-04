import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Dialog, FormControl, IconButton, SegmentedControl, Select, Stack, Text, Textarea, TextInput } from '@primer/react'
import { EyeClosedIcon, EyeIcon, ZapIcon } from '@primer/octicons-react'
import { SecretService } from './bindings'
import { Kind } from '../../bindings/github.com/alicoding/mill/internal/domain/secret/models'
import { refreshSecretTitles } from './secretTitleCache'
import styles from './SecretsEntryDialog.module.css'

// Create/edit form (goal 0185 S2, goal 0306). editID names an existing
// entry to load and edit; opening Edit is an explicit, auditable reveal
// (the only way to load Password/Notes into the form without silently
// wiping them on save) -- same posture as the detail dialog's own
// reveal toggle, just triggered by choosing Edit instead of Show.
//
// An entry either holds its value here or names a key in a configured
// source; the source's value is read when something uses it and is
// never copied in. Kind decides which control the value gets and which
// fields this entry can be picked for.

// MULTILINE_KINDS are the kinds whose value is normally more than one
// line, mirroring secret.Kind.Multiline on the Go side.
const MULTILINE_KINDS: Kind[] = [Kind.KindKey, Kind.KindCertificate, Kind.KindFile]

const KIND_ORDER: Kind[] = [Kind.KindText, Kind.KindKey, Kind.KindCertificate, Kind.KindFile]

export function SecretsEntryDialog({ editID, defaultTitle, defaultKind, onClose, onSaved }: {
  editID: string | null
  // defaultTitle/defaultKind prefill a brand-new entry created from a
  // field that already knows what it is asking for.
  defaultTitle?: string
  defaultKind?: Kind
  onClose: () => void
  // onSaved receives the entry's id, so a caller that opened this to
  // fill a field can point that field at what was just created.
  onSaved: (id: string) => void
}) {
  const { t } = useTranslation('secrets')
  const [loaded, setLoaded] = useState(editID === null)
  const [title, setTitle] = useState(defaultTitle ?? '')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [url, setURL] = useState('')
  const [notes, setNotes] = useState('')
  const [tags, setTags] = useState('')
  const [kind, setKind] = useState<Kind>(defaultKind ?? Kind.KindText)
  const [sourceRef, setSourceRef] = useState('')
  const [fromSource, setFromSource] = useState(false)
  const [sourceKeys, setSourceKeys] = useState<{ ID: string; Title: string }[]>([])
  const [revealed, setRevealed] = useState(editID === null) // a brand-new entry starts revealed -- nothing to hide yet
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    SecretService.ListProviderSecrets()
      .then((list) => setSourceKeys((list ?? []).map((e) => ({ ID: e.ID, Title: e.Title }))))
      .catch(() => setSourceKeys([]))
  }, [])

  useEffect(() => {
    if (editID === null) return
    SecretService.RevealSecret(editID).then((e) => {
      setTitle(e.Title); setUsername(e.Username); setPassword(e.Password)
      setURL(e.URL); setNotes(e.Notes); setTags(e.Tags)
      setKind(e.Kind || Kind.KindText); setSourceRef(e.SourceRef ?? ''); setFromSource((e.SourceRef ?? '') !== '')
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
    if (fromSource && sourceRef === '') {
      setError(t('noSourcesConfigured'))
      return
    }
    setSaving(true)
    setError('')
    try {
      const stored = fromSource ? sourceRef : ''
      const saved = editID
        ? await SecretService.UpdateSecret(editID, title, username, password, url, notes, tags, kind, stored)
        : await SecretService.CreateSecret(title, username, password, url, notes, tags, kind, stored)
      await refreshSecretTitles()
      onSaved(saved.ID)
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
            <FormControl.Label>{t('fields.kind')}</FormControl.Label>
            <Select value={kind} onChange={(e) => setKind(e.target.value as Kind)} data-testid="secret-kind-select">
              {KIND_ORDER.map((k) => <Select.Option key={k} value={k}>{t(`kinds.${k}`)}</Select.Option>)}
            </Select>
          </FormControl>

          <SegmentedControl aria-label={t('fields.storage')} data-testid="secret-storage-mode">
            <SegmentedControl.Button selected={!fromSource} onClick={() => setFromSource(false)} data-testid="secret-storage-here">
              {t('storage.here')}
            </SegmentedControl.Button>
            <SegmentedControl.Button selected={fromSource} onClick={() => { setFromSource(true); setSourceRef((r) => r || (sourceKeys[0]?.ID ?? '')) }} data-testid="secret-storage-source">
              {t('storage.fromASource')}
            </SegmentedControl.Button>
          </SegmentedControl>

          {fromSource ? (
            <SourceKeyField sourceRef={sourceRef} setSourceRef={setSourceRef} sourceKeys={sourceKeys} />
          ) : (
            <ValueField
              kind={kind}
              password={password}
              setPassword={setPassword}
              revealed={revealed}
              setRevealed={setRevealed}
              generate={generate}
            />
          )}

          <FormControl>
            <FormControl.Label>{t('fields.username')}</FormControl.Label>
            <TextInput value={username} onChange={(e) => setUsername(e.target.value)} block data-testid="secret-username-input" />
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

// SourceKeyField names the key this entry reads at use time. Its own
// component so the dialog above stays one readable flow rather than
// three nested conditionals (eslint sonarjs/cognitive-complexity).
function SourceKeyField({ sourceRef, setSourceRef, sourceKeys }: {
  sourceRef: string
  setSourceRef: (ref: string) => void
  sourceKeys: { ID: string; Title: string }[]
}) {
  const { t } = useTranslation('secrets')
  return (
    <FormControl>
      <FormControl.Label>{t('fields.sourceKey')}</FormControl.Label>
      <FormControl.Caption>{t('fields.sourceKeyCaption')}</FormControl.Caption>
      {sourceKeys.length === 0 ? (
        <Text as="p" size="small" data-testid="secret-no-sources">{t('noSourcesConfigured')}</Text>
      ) : (
        <Select value={sourceRef} onChange={(e) => setSourceRef(e.target.value)} data-testid="secret-source-select">
          {sourceKeys.map((e) => <Select.Option key={e.ID} value={e.ID}>{e.Title}</Select.Option>)}
        </Select>
      )}
    </FormControl>
  )
}

// ValueField is the value this entry holds. A key, certificate or file
// is pasted rather than typed, so those kinds get a multi-line control
// and no reveal toggle -- there is nothing shoulder-surfable about a
// PEM header, and hiding it would only make a paste unverifiable.
function ValueField({ kind, password, setPassword, revealed, setRevealed, generate }: {
  kind: Kind
  password: string
  setPassword: (v: string) => void
  revealed: boolean
  setRevealed: (fn: (r: boolean) => boolean) => void
  generate: () => void
}) {
  const { t } = useTranslation('secrets')
  // A key, certificate or file is a value, not a password: calling it
  // one would be Mill's vocabulary, not the reader's.
  const multiline = MULTILINE_KINDS.includes(kind)
  return (
    <FormControl>
      <FormControl.Label>{multiline ? t('fields.value') : t('fields.password')}</FormControl.Label>
      {multiline ? (
        <Textarea
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          block
          rows={8}
          className={styles.keyInput}
          data-testid="secret-password-input"
        />
      ) : (
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
      )}
    </FormControl>
  )
}
