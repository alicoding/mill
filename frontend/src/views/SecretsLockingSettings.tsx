import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { Checkbox, FormControl, Select, Stack, TextInput } from '@primer/react'
import { SecretService } from '../shared/bindings'
import type { LockPolicy } from '../shared/bindings'
import {
  CUSTOM_MINUTES_MAX,
  CUSTOM_MINUTES_MIN,
  humanizeLockAfter,
  isLockAfterPreset,
  LOCK_AFTER_PRESETS,
  unlockToggleLabelKey,
} from '../shared/vaultLockCopy'
import styles from './SecretsView.module.css'

// The vault's lock policy: one idle timeout, the events that lock it
// regardless, and the requirement that guards re-opening it. Grouped
// because they answer one question between them -- when does this
// vault close, and what does it take to get back in -- which is the
// shape every password manager's own security settings converge on.
//
// The whole policy is submitted on every edit (SetVaultLockPolicy takes
// all four fields), so a half-written policy is not a state that can
// exist; the control that changed just contributes its new value.
export default function SecretsLockingSettings({ capability, requireAuth, authAvailable, onToggleUnlockRequirement, unlockBusy, locked }: {
  capability: string
  requireAuth: boolean
  authAvailable: boolean
  onToggleUnlockRequirement: (enabled: boolean) => void
  unlockBusy: boolean
  // Settings > Security renders this component regardless of vault
  // state (goal 0360 S1 follow-up) -- SetTouchIDProtection itself
  // requires an open vault, so only the unlock-requirement toggle
  // reacts to `locked`; the rest of the policy needs no open vault
  // (secretservice_lockpolicy.go's own SetVaultLockPolicy doc comment).
  locked: boolean
}) {
  const { t } = useTranslation('secrets')
  const [policy, setPolicy] = useState<LockPolicy | null>(null)
  // Whether the custom minutes field is showing. Held separately from
  // the policy because "Custom" stays chosen while the reader clears
  // the field to retype it, which momentarily has no valid value to
  // store.
  const [custom, setCustom] = useState(false)
  const [customMinutes, setCustomMinutes] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    SecretService.VaultLockPolicy()
      .then((p) => {
        setPolicy(p)
        if (!isLockAfterPreset(p.LockAfterSeconds)) {
          setCustom(true)
          setCustomMinutes(String(Math.round(p.LockAfterSeconds / 60)))
        }
      })
      .catch((err) => setError(String(err)))
  }, [])

  const save = (next: LockPolicy) => {
    setPolicy(next)
    setError('')
    SecretService.SetVaultLockPolicy(next)
      .then(() => SecretService.VaultLockPolicy())
      .then(setPolicy)
      .catch((err) => setError(String(err)))
  }

  if (policy === null) return null

  const chooseTimeout = (value: string) => {
    if (value === 'custom') {
      setCustom(true)
      setCustomMinutes(String(Math.max(CUSTOM_MINUTES_MIN, Math.round(policy.LockAfterSeconds / 60))))
      return
    }
    setCustom(false)
    save({ ...policy, LockAfterSeconds: Number(value) })
  }

  // A custom entry is stored only once it is a whole number of minutes
  // inside the offered range: typing "1" on the way to "120" must not
  // save a one-minute timeout that then fights the next keystroke.
  const typeCustomMinutes = (value: string) => {
    setCustomMinutes(value)
    const minutes = Number(value)
    if (!Number.isInteger(minutes) || minutes < CUSTOM_MINUTES_MIN || minutes > CUSTOM_MINUTES_MAX) return
    save({ ...policy, LockAfterSeconds: minutes * 60 })
  }

  return (
    <Stack direction="vertical" gap="normal" data-testid="secrets-locking">
      <FormControl>
        <FormControl.Label>{t('locking.lockAfterLabel')}</FormControl.Label>
        <Select
          value={custom ? 'custom' : String(policy.LockAfterSeconds)}
          onChange={(e) => chooseTimeout(e.target.value)}
          data-testid="secrets-lock-after"
        >
          {LOCK_AFTER_PRESETS.map((seconds) => (
            <Select.Option key={seconds} value={String(seconds)}>
              {presetLabel(t, seconds)}
            </Select.Option>
          ))}
          <Select.Option value="custom">{t('locking.presetCustom')}</Select.Option>
        </Select>
        <FormControl.Caption>{t('locking.lockAfterCaption')}</FormControl.Caption>
      </FormControl>
      {custom && (
        <FormControl>
          <FormControl.Label>{t('locking.customMinutesLabel')}</FormControl.Label>
          <TextInput
            type="number"
            min={CUSTOM_MINUTES_MIN}
            max={CUSTOM_MINUTES_MAX}
            value={customMinutes}
            onChange={(e) => typeCustomMinutes(e.target.value)}
            data-testid="secrets-lock-after-custom"
          />
        </FormControl>
      )}
      <FormControl>
        <Checkbox
          checked={policy.LockOnSleep}
          onChange={(e) => save({ ...policy, LockOnSleep: e.target.checked })}
          data-testid="secrets-lock-on-sleep"
        />
        <FormControl.Label>{t('locking.onSleepLabel')}</FormControl.Label>
      </FormControl>
      <FormControl>
        <Checkbox
          checked={policy.LockOnUserSwitch}
          onChange={(e) => save({ ...policy, LockOnUserSwitch: e.target.checked })}
          data-testid="secrets-lock-on-user-switch"
        />
        <FormControl.Label>{t('locking.onUserSwitchLabel')}</FormControl.Label>
      </FormControl>
      <FormControl>
        <Checkbox
          checked={policy.LockOnMinimize}
          onChange={(e) => save({ ...policy, LockOnMinimize: e.target.checked })}
          data-testid="secrets-lock-on-minimize"
        />
        <FormControl.Label>{t('locking.onMinimizeLabel')}</FormControl.Label>
      </FormControl>
      <FormControl disabled={!authAvailable || locked}>
        <Checkbox
          checked={requireAuth}
          disabled={unlockBusy || !authAvailable || locked}
          onChange={(e) => onToggleUnlockRequirement(e.target.checked)}
          data-testid="secrets-touchid-toggle"
        />
        <FormControl.Label>{t(unlockToggleLabelKey(capability))}</FormControl.Label>
        <FormControl.Caption>
          {t(unlockCaptionKey(locked, authAvailable))}
        </FormControl.Caption>
      </FormControl>
      {error && <span className={styles.error} data-testid="secrets-locking-error">{error}</span>}
    </Stack>
  )
}

// A preset's menu label is the same unit wording the status line uses
// for the same timeout, so the menu and the sentence under it can never
// name one duration two ways.
function presetLabel(t: TFunction<'secrets'>, seconds: number): string {
  const humanized = humanizeLockAfter(seconds)
  return humanized === null ? t('locking.presetNever') : t(humanized.key, { count: humanized.count })
}

// The unlock-requirement toggle's caption: what changing it takes,
// ranked by what stops the reader from doing it right now -- an open
// vault is required before hardware availability even matters.
function unlockCaptionKey(locked: boolean, authAvailable: boolean): string {
  if (locked) return 'locking.unlockToChangeCaption'
  return authAvailable ? 'touchId.toggleCaption' : 'touchId.unavailableCaption'
}
