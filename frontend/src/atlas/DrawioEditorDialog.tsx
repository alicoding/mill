import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Dialog, Text } from '@primer/react'
import type { BoardObject } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { MirrorKind } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { AtlasService } from '../shared/bindings'
import { basenameOf } from './atlasCardPresentation'
import { DrawioEditorMount } from './DrawioEditorMount'
import { AtlasMirrorMissingState } from './AtlasMirrorMissingState'
import { closeAtlasEditDiagram } from './atlasEditDiagramStore'
import runbookStyles from '../shared/ListCard.module.css'
import styles from './DrawioEditorDialog.module.css'

// The embedded editor engine's own large modal surface (goal 0237 S1,
// the What's-new/AtlasRoadmapView Dialog precedent scaled up to near-
// full-window): title is the mirrored file's own basename, Primer's
// own Dialog close control is the one close affordance, and the
// editor's OWN Exit/Save-and-Exit buttons (part of the real engine's
// UI, not Mill-drawn chrome) reach the same close path through the
// documented protocol's 'exit'/'save+exit' events -- DrawioEditorMount
// forwards both into onExit here. Unsaved-changes protection is the
// protocol's own autosave: every edit already lands on the mirror file
// via 'autosave' before either close path can ever fire.
export function DrawioEditorDialog({ object, onClose }: { object: BoardObject; onClose: () => void }) {
  const { t } = useTranslation('atlas')
  const [initialXML, setInitialXML] = useState<string | null>(null)
  const [missing, setMissing] = useState(false)
  const [error, setError] = useState('')
  const mirrorPath = object.Payload?.mirrorPath ?? ''

  useEffect(() => {
    setInitialXML(null)
    setMissing(false)
    setError('')
    AtlasService.ObjectMirrorContent(object.ID)
      .then((content) => {
        if (content.Missing) {
          setMissing(true)
          return
        }
        setInitialXML(content.Kind === MirrorKind.MirrorKindText ? content.Content : '')
      })
      .catch((err) => setError(String(err)))
    // mirrorPath in deps: a re-pick from the missing state above swaps
    // it without changing object.ID, and the freshly re-picked file's
    // content needs re-fetching, same as AtlasDiagramObjectContent.tsx's
    // own identity effect.
  }, [object.ID, mirrorPath])

  const handleExit = () => {
    closeAtlasEditDiagram()
    onClose()
  }

  return (
    <Dialog
      title={basenameOf(mirrorPath) || t('drawio.editor.untitledDiagram')}
      onClose={handleExit}
      width="calc(100vw - 48px)"
      data-component="atlas-drawio-editor-dialog"
      className={styles.dialog}
      // Dialog's own `height` prop only accepts its small/auto/large
      // presets (unlike `width`, which forwards any CSS string via a
      // --dialog-width custom property) -- an inline style height wins
      // over the module's data-height="auto" rule the same way this
      // component's other overrides do.
      style={{ height: 'calc(100vh - 48px)' }}
    >
      <div className={styles.body}>
        {error && <Text as="p" size="small" className={runbookStyles.error} data-testid="drawio-editor-error">{error}</Text>}
        {!error && missing && (
          <AtlasMirrorMissingState
            testIdPrefix="drawio-editor"
            onRepick={(path) => AtlasService.RepickObjectMirror(object.ID, path)}
          />
        )}
        {!error && !missing && initialXML === null && (
          <Text as="p" size="small" className={runbookStyles.muted} data-testid="drawio-editor-loading">{t('overlay.mirrorLoading')}</Text>
        )}
        {!error && !missing && initialXML !== null && (
          <DrawioEditorMount
            objectID={object.ID}
            initialXML={initialXML}
            onExit={handleExit}
            onError={setError}
          />
        )}
      </div>
    </Dialog>
  )
}
