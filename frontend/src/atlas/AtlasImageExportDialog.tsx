import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Checkbox, Dialog, FormControl, SegmentedControl, Stack, Text } from '@primer/react'

// "Export as image..." (docs/goals/0201): the two choices a picture of
// a board actually has. Padding is deliberately absent -- it is fixed
// (atlasImageExport.ts's IMAGE_EXPORT_PADDING), because a padding knob
// is a setting nobody returns to.
//
// "Copy as image" opens nothing at all: a fast copy that stops to ask
// is no longer fast, so it takes this dialog's own defaults.

export interface ImageExportSettings {
  scale: number
  transparent: boolean
}

const SCALE_OPTIONS = [1, 2, 3]
// 2x is the default everywhere in this class of tool: sharp on the
// display the picture was composed on, still a reasonable file size.
const DEFAULT_SCALE_INDEX = 1

export function AtlasImageExportDialog({ busy, onCancel, onExport }: {
  busy: boolean
  onCancel: () => void
  onExport: (settings: ImageExportSettings) => void
}) {
  const { t } = useTranslation('atlas')
  const [scaleIndex, setScaleIndex] = useState(DEFAULT_SCALE_INDEX)
  const [transparent, setTransparent] = useState(false)

  return (
    <Dialog
      title={t('imageExport.title')}
      onClose={onCancel}
      width="small"
      data-component="atlas-image-export-dialog"
      footerButtons={[
        { content: t('cancel'), onClick: onCancel },
        {
          content: t('imageExport.exportButton'),
          buttonType: 'primary',
          disabled: busy,
          // The chosen values are read HERE and passed down, never
          // re-read from state by the handler that renders the image
          // (.claude/rules/testing.md: setState is not synchronous).
          onClick: () => onExport({ scale: SCALE_OPTIONS[scaleIndex], transparent }),
        },
      ]}
    >
      <Stack direction="vertical" gap="normal">
        <Stack direction="vertical" gap="condensed">
          <Text size="small" weight="semibold">{t('imageExport.scaleLabel')}</Text>
          <SegmentedControl aria-label={t('imageExport.scaleLabel')} size="small" onChange={setScaleIndex}>
            {SCALE_OPTIONS.map((factor, index) => (
              <SegmentedControl.Button
                key={factor}
                selected={index === scaleIndex}
                data-testid={`atlas-image-export-scale-${factor}`}
              >
                {t('imageExport.scaleOption', { factor })}
              </SegmentedControl.Button>
            ))}
          </SegmentedControl>
        </Stack>
        <FormControl>
          <Checkbox
            checked={transparent}
            data-testid="atlas-image-export-transparent"
            onChange={(e) => setTransparent(e.target.checked)}
          />
          <FormControl.Label>{t('imageExport.transparentLabel')}</FormControl.Label>
          <FormControl.Caption>{t('imageExport.transparentCaption')}</FormControl.Caption>
        </FormControl>
      </Stack>
    </Dialog>
  )
}
