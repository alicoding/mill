import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Stack, Text } from '@primer/react'
import { ConfigureService } from '../shared/bindings'
import { useAppStore } from '../shared/store'
import { useUISignalStore } from '../shared/uiSignalStore'
import { background } from '../shared/background'
import styles from '../shared/ListCard.module.css'

// What this request's host already has (goal 0306 S1). A client
// certificate is configured per host and applies to every request Mill
// makes there, so this line reports a fact rather than offering a
// setting: nothing here is stored on the request.
export function ClientCertMatchLine({ baseURL }: { baseURL: string }) {
  const { t } = useTranslation('configure')
  const [match, setMatch] = useState<{ label: string } | null>(null)
  const [host, setHost] = useState('')

  useEffect(() => {
    const parsedHost = hostOf(baseURL)
    setHost(parsedHost)
    if (parsedHost === '') {
      setMatch(null)
      return
    }
    void background(ConfigureService.MatchClientCertificate(baseURL).then(([found, ok]) => {
      setMatch(ok ? { label: found.label } : null)
    }), 'clientCertMatchLine.match')
  }, [baseURL])

  if (host === '') return null

  const addOne = () => {
    useAppStore.getState().setView({ kind: 'configure', tab: 'certificates' })
    useUISignalStore.getState().requestConfigureCreateWith('certificates', host)
  }

  return (
    <Stack direction="horizontal" gap="condensed" align="center">
      {match ? (
        <Text as="p" size="small" className={styles.muted} data-testid="clientcert-match">
          {t('requestAuthSections.clientCertificateMatched', { label: match.label })}
        </Text>
      ) : (
        <>
          <Text as="p" size="small" className={styles.muted} data-testid="clientcert-match-none">
            {t('requestAuthSections.clientCertificateNone')}
          </Text>
          <Button size="small" variant="invisible" onClick={addOne} data-testid="clientcert-add-one">
            {t('requestAuthSections.clientCertificateAddOne')}
          </Button>
        </>
      )}
    </Stack>
  )
}

// hostOf reads the authority a certificate is matched on. A base URL
// still being typed has none yet, which is why the line renders
// nothing at all rather than an empty claim.
function hostOf(rawURL: string): string {
  try {
    return new URL(rawURL).host.toLowerCase()
  } catch {
    return ''
  }
}
