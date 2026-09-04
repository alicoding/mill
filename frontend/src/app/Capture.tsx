import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Events } from '@wailsio/runtime'
import { Button, FormControl, Select, Stack, Text } from '@primer/react'
import { AtlasService, SettingsService } from '../shared/bindings'
import type { Card, Note } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { MilkdownEditor } from '../shared/MilkdownEditor'
import { getPluginCapture, type PluginCapture } from '../plugins/pluginCaptures'
import { currentPluginTheme, onPluginThemeChange } from '../plugins/pluginTheme'
import { SEEDED_SCRATCHPAD_CARD_ID, cascadeNotePosition } from './quickPanelCapture'
import styles from './Capture.module.css'

// The capture window's content (goal 0309): one capture face -- Mill's
// own note, or a plugin's registered face -- with the destination
// chosen in the header and remembered per capture kind. Summoned away
// from the canvas (the Quick Panel, the palette); the target arrives
// in the hash query (`#/capture?plugin=…&id=…`, the e2e's door) or on
// the mill-capture event (the live window's). ⌘↩ saves the note, Esc
// closes (the window's own HideOnEscape), Cancel closes without
// writing.

interface Target { pluginID: string; captureID: string }

function targetFromHash(): Target | null {
  const query = window.location.hash.split('?')[1]
  if (!query) return null
  const params = new URLSearchParams(query)
  const captureID = params.get('id') ?? ''
  if (!captureID) return null
  return { pluginID: params.get('plugin') ?? '', captureID }
}

export function destinationKey(target: Target): string {
  return target.pluginID ? `${target.pluginID}/${target.captureID}` : target.captureID
}

// destinationOptions: the seeded Scratchpad first (the away-capture
// door's own inbox, goal 0090), then every top-level card by title,
// then the board's top level.
export function destinationOptions(cards: Card[]): { id: string; label: string }[] {
  const scratchpad = cards.find((c) => c.ID === SEEDED_SCRATCHPAD_CARD_ID)
  const roots = cards.filter((c) => !c.ParentID && c.ID !== SEEDED_SCRATCHPAD_CARD_ID).sort((a, b) => a.Title.localeCompare(b.Title))
  return [
    ...(scratchpad ? [{ id: scratchpad.ID, label: scratchpad.Title }] : []),
    ...roots.map((c) => ({ id: c.ID, label: c.Title })),
  ]
}

export function Capture() {
  const { t } = useTranslation('app')
  const [target, setTarget] = useState<Target | null>(targetFromHash)
  const [cards, setCards] = useState<Card[]>([])
  const [notes, setNotes] = useState<Note[]>([])
  const [destination, setDestination] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const faceRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    return Events.On('mill-capture', (evt) => {
      const data = evt.data as Target
      if (data?.captureID) {
        setTarget({ pluginID: data.pluginID ?? '', captureID: data.captureID })
        setText('')
        setError('')
      }
    })
  }, [])

  // Cards and notes: the destination list and the cascade; refreshed
  // on every target so a capture never lands on a stale board.
  useEffect(() => {
    if (!target) return
    let live = true
    Promise.all([AtlasService.Cards(), AtlasService.Notes(), SettingsService.GetCaptureDestinations()])
      .then(([c, n, remembered]) => {
        if (!live) return
        const list = c ?? []
        setCards(list)
        setNotes(n ?? [])
        const options = destinationOptions(list)
        const wanted = remembered?.[destinationKey(target)]
        const known = wanted !== undefined && (wanted === '' || options.some((o) => o.id === wanted))
        setDestination(known ? wanted : (options[0]?.id ?? ''))
      })
      .catch((err) => { if (live) setError(String(err)) })
    return () => { live = false }
  }, [target])

  const options = useMemo(() => destinationOptions(cards), [cards])
  const close = () => { void SettingsService.HideCapture().catch(() => {}) }
  const rememberDestination = (id: string) => {
    setDestination(id)
    if (target) void SettingsService.SetCaptureDestination(destinationKey(target), id).catch(() => {})
  }

  const saveNote = async () => {
    if (!target || destination === null) return
    const body = text.trim()
    if (!body) return
    setSaving(true)
    setError('')
    try {
      await AtlasService.CreateNote(body, cascadeNotePosition(notes, destination), destination)
      setText('')
      close()
    } catch (err) {
      setError(t('capture.saveError') + ' ' + String(err))
    } finally {
      setSaving(false)
    }
  }

  const isNote = !!target && !target.pluginID && target.captureID === 'note'
  const pluginCapture = target && target.pluginID ? getPluginCapture(target.pluginID, target.captureID) : undefined

  usePluginFace(faceRef, pluginCapture, destination, close)
  useSaveShortcut(isNote, saveNote)

  if (!target) {
    return <Text as="p" size="small" className={styles.muted} data-testid="capture-no-target">{t('capture.noTarget')}</Text>
  }
  const title = isNote ? t('capture.noteTitle') : (pluginCapture?.label ?? target.captureID)

  return (
    <Stack direction="vertical" gap="condensed" className={styles.shell} data-testid="capture-window" data-capture-id={target.captureID}>
      <Stack direction="horizontal" justify="space-between" align="center" gap="condensed">
        <Text as="h1" size="medium" weight="semibold" className={styles.title}>{title}</Text>
        <FormControl>
          <FormControl.Label visuallyHidden>{t('capture.landsIn')}</FormControl.Label>
          <Select size="small" value={destination ?? ''} onChange={(e) => rememberDestination(e.target.value)} data-testid="capture-destination" aria-label={t('capture.landsIn')}>
            {options.map((o) => <Select.Option key={o.id} value={o.id}>{o.label}</Select.Option>)}
            <Select.Option value="">{t('capture.topLevel')}</Select.Option>
          </Select>
        </FormControl>
      </Stack>
      {isNote && (
        <div className={styles.editor}>
          <MilkdownEditor value={text} onChange={setText} ariaLabel={t('capture.noteAriaLabel')} placeholder={t('capture.notePlaceholder')} testId="capture-note" />
        </div>
      )}
      {target.pluginID && !pluginCapture && (
        <Text as="p" size="small" className={styles.error} data-testid="capture-missing-face">{t('capture.missingFace', { plugin: target.pluginID, id: target.captureID })}</Text>
      )}
      {pluginCapture && <div ref={faceRef} className={styles.face} data-testid="capture-plugin-face" />}
      {error && <Text as="p" size="small" className={styles.error} data-testid="capture-error">{error}</Text>}
      <Stack direction="horizontal" justify="space-between" align="center" gap="condensed">
        <Text size="small" className={styles.muted}>{isNote ? t('capture.saveHint') : ''}</Text>
        <Stack direction="horizontal" gap="condensed">
          <Button size="small" variant="invisible" onClick={close} data-testid="capture-cancel">{t('capture.cancel')}</Button>
          {isNote && (
            <Button size="small" variant="primary" onClick={() => { void saveNote() }} disabled={saving || !text.trim()} data-testid="capture-save">{t('capture.save')}</Button>
          )}
        </Stack>
      </Stack>
    </Stack>
  )
}

// A plugin face renders into the host-owned div once the destination
// is known; it writes through the content doors and calls done().
function usePluginFace(faceRef: React.RefObject<HTMLDivElement | null>, pluginCapture: PluginCapture | undefined, destination: string | null, close: () => void) {
  useEffect(() => {
    const el = faceRef.current
    if (!el || !pluginCapture || destination === null) return
    el.replaceChildren()
    try {
      pluginCapture.render(el, { destinationId: destination, done: close, cancel: close, theme: currentPluginTheme(), onThemeChange: onPluginThemeChange })
    } catch (err) {
      console.error(`plugin ${pluginCapture.pluginId} capture render failed`, err)
    }
    return () => { el.replaceChildren() }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- close is stable in effect (it only calls the hide RPC)
  }, [faceRef, pluginCapture, destination])
}

// ⌘↩ / Ctrl+↩ saves the note (the Quick Panel's own key vocabulary).
function useSaveShortcut(enabled: boolean, save: () => Promise<void>) {
  useEffect(() => {
    if (!enabled) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        void save()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })
}
