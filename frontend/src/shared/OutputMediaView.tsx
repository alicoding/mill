import { useTranslation } from 'react-i18next'
import { Stack, Text } from '@primer/react'
import styles from './OutputViewer.module.css'
import type { BinaryOutput } from './outputMedia'

// Bytes as a reader reads them, not as a machine counts them.
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// The binary branch (goal 0326): bytes are not text and are never
// rendered as if they were. A picture, a sound or a video the browser
// can play is played; anything else states what it is -- name, type,
// size -- and offers to save it.
export function OutputMediaView({ binary, ariaLabel, testId }: { binary: BinaryOutput; ariaLabel: string; testId?: string }) {
  const { t } = useTranslation('common')
  const type = binary.mime ?? ''
  if (binary.src && type.startsWith('image/')) {
    return <img className={styles.media} src={binary.src} alt={ariaLabel} data-testid={testId} />
  }
  if (binary.src && type.startsWith('audio/')) {
    return <audio className={styles.media} src={binary.src} controls aria-label={ariaLabel} data-testid={testId} />
  }
  if (binary.src && type.startsWith('video/')) {
    return <video className={styles.media} src={binary.src} controls aria-label={ariaLabel} data-testid={testId} />
  }
  const facts = [binary.name, type, binary.size !== undefined ? formatSize(binary.size) : ''].filter(Boolean)
  return (
    <Stack direction="vertical" gap="none" className={styles.binary} data-testid={testId}>
      <Text size="small">{facts.length > 0 ? facts.join(' · ') : t('output.empty')}</Text>
    </Stack>
  )
}
