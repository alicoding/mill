import { Kind } from '../../bindings/github.com/alicoding/mill/internal/domain/secretsource/models'
import type { SecretSourceKindInfo } from '../../bindings/github.com/alicoding/mill/internal/services/pluginsvc/models'

// How one secret-source kind renders: the built-in kinds carry Mill's
// own wording, an extension's kind carries the wording its manifest
// declares (goal 0306 S4). Kept out of the page component so the two
// vocabularies meet in one place with their own tests, and so the page
// stays one readable form.

type Translate = (key: string, values?: Record<string, string>) => string

// PathField is how the path control renders for a kind: hidden
// entirely when the kind names no path.
export interface PathField {
  shown: boolean
  label: string
  placeholder: string
  caption: string
}

// kindLabel names a kind in a row and in the picker. An extension's
// kind whose extension is gone has no declared label left, so it falls
// back to the generic noun rather than showing its raw kind string.
export function kindLabel(kind: string, pluginKinds: SecretSourceKindInfo[], t: Translate): string {
  switch (kind) {
    case Kind.KindBruno: return t('configureSecretSources.kindBruno')
    case Kind.KindOnePassword: return t('configureSecretSources.kindOnePassword')
    case Kind.KindBitwarden: return t('configureSecretSources.kindBitwarden')
    case Kind.KindEnv: return t('configureSecretSources.kindDotenv')
    default: return pluginKinds.find((p) => p.Kind === kind)?.Label ?? t('configureSecretSources.kindExtension')
  }
}

// problemText states a source's current problem. An extension answers
// with a code so this page can say it in the reader's own language;
// every other provider already answers with a sentence.
export function problemText(code: string, t: Translate): string {
  if (code === 'plugin-not-installed') return t('configureSecretSources.problemPluginMissing')
  if (code === 'plugin-turned-off') return t('configureSecretSources.problemPluginDisabled')
  return code
}

export function pathField(kind: string, plugin: SecretSourceKindInfo | undefined, t: Translate): PathField {
  if (plugin) {
    return {
      shown: plugin.PathKind !== 'none',
      label: plugin.PathLabel,
      placeholder: plugin.PathPlaceholder,
      caption: '',
    }
  }
  const builtIn = builtInPathFields(t)[kind] ?? builtInPathFields(t)[Kind.KindEnv]
  return { shown: true, ...builtIn }
}

function builtInPathFields(t: Translate): Record<string, Omit<PathField, 'shown'>> {
  return {
    [Kind.KindEnv]: {
      label: t('configureSecretSources.path'),
      placeholder: t('configureSecretSources.pathPlaceholderDotenv'),
      caption: t('configureSecretSources.pathCaption'),
    },
    [Kind.KindBruno]: {
      label: t('configureSecretSources.path'),
      placeholder: t('configureSecretSources.pathPlaceholderBruno'),
      caption: t('configureSecretSources.pathCaptionBruno'),
    },
    [Kind.KindOnePassword]: {
      label: t('configureSecretSources.filter'),
      placeholder: t('configureSecretSources.pathPlaceholderOnePassword'),
      caption: t('configureSecretSources.pathCaptionOnePassword'),
    },
    [Kind.KindBitwarden]: {
      label: t('configureSecretSources.filter'),
      placeholder: '',
      caption: t('configureSecretSources.pathCaptionBitwarden'),
    },
  }
}
