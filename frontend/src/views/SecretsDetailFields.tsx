import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FormControl, IconButton, Label, LabelGroup, Stack, Text, TextInput } from '@primer/react'
import { CopyIcon, EyeClosedIcon, EyeIcon } from '@primer/octicons-react'
import type { Field } from '../../bindings/github.com/alicoding/mill/internal/domain/secret/models'

// The read side of an entry's own record (goal 0306 S4): its custom
// fields, its tags, and where it came from. Its own file so the detail
// dialog stays one readable flow.

export function SecretDetailFields({ fields }: { fields: Field[] }) {
  if (fields.length === 0) return null
  return (
    <>
      {fields.map((field) => <DetailField key={field.Name} field={field} />)}
    </>
  )
}

function DetailField({ field }: { field: Field }) {
  const { t } = useTranslation('secrets')
  const [revealed, setRevealed] = useState(!field.Protected)
  const [copied, setCopied] = useState(false)
  const copy = () => {
    void navigator.clipboard.writeText(field.Value).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }
  return (
    <FormControl>
      <FormControl.Label>{field.Name}</FormControl.Label>
      <Stack direction="horizontal" gap="condensed" align="center">
        <TextInput
          type={revealed ? 'text' : 'password'}
          value={field.Value}
          readOnly
          block
          data-testid={`secret-detail-field-${field.Name}`}
          trailingAction={field.Protected ? (
            <TextInput.Action
              icon={revealed ? EyeClosedIcon : EyeIcon}
              aria-label={revealed ? t('hide') : t('reveal')}
              onClick={() => setRevealed((r) => !r)}
            />
          ) : undefined}
        />
        <IconButton icon={CopyIcon} aria-label={t('copy')} size="small" variant="invisible" onClick={copy} data-testid={`secret-detail-field-copy-${field.Name}`} />
      </Stack>
      {copied && <FormControl.Caption>{t('copied')}</FormControl.Caption>}
    </FormControl>
  )
}

export function SecretDetailTags({ tags }: { tags: string[] }) {
  const { t } = useTranslation('secrets')
  if (tags.length === 0) return null
  return (
    <FormControl>
      <FormControl.Label>{t('detail.tagsLabel')}</FormControl.Label>
      <LabelGroup>
        {tags.map((tag) => <Label key={tag} data-testid={`secret-detail-tag-${tag}`}>{tag}</Label>)}
      </LabelGroup>
    </FormControl>
  )
}

// SecretDetailSource says where this entry came from: a source it reads
// through, a file it was imported out of, or the reader's own hand.
export function SecretDetailSource({ sourceRef, origin, sourceLabel }: {
  sourceRef: string
  origin: string
  sourceLabel: string
}) {
  const { t } = useTranslation('secrets')
  const caption = sourceRef !== ''
    ? t('detail.sourceFrom', { source: sourceLabel })
    : origin.startsWith('import:')
      ? t('detail.sourceImported', { file: origin.slice('import:'.length) })
      : t('detail.sourceByHand')
  return (
    <FormControl>
      <FormControl.Label>{t('detail.sourceLabel')}</FormControl.Label>
      <Text as="p" size="small" data-testid="secret-detail-source">{caption}</Text>
    </FormControl>
  )
}
