import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { IconButton } from '@primer/react'
import { BoldIcon, CodeIcon, ItalicIcon, StrikethroughIcon } from '@primer/octicons-react'
import type { SelectionToolbarAction, SelectionToolbarHandle, SelectionToolbarState } from './milkdownCore'
import styles from './MilkdownEditor.module.css'

export interface MilkdownEditorProps {
  value: string
  onChange?: (value: string) => void
  ariaLabel: string
  placeholder?: string
  testId?: string
  // Hands the caller a synchronous "read the doc right now" accessor
  // once the engine mounts (undefined again on unmount) -- the
  // authoritative source for a commit, never `onChange`'s own last-
  // delivered value. Milkdown's markdownUpdated listener is DEBOUNCED
  // (measured live: a commit fired within ~100ms of the triggering
  // keystroke/click can land before the listener ever runs, persisting
  // stale or even empty text -- a real race, not a test-timing
  // artifact, since a fast pointer-driven commit is exactly this
  // surface's own interaction model). getMarkdown() reads the live
  // ProseMirror document directly, immune to that debounce.
  onReady?: (getMarkdown: (() => string) | undefined) => void
}

type CoreModule = typeof import('./milkdownCore')

// The ONE editor door for the note's markdown-canonical WYSIWYG
// (ports/adapters, mirroring shared/CodeEditor.tsx's own door): no
// @milkdown import may appear outside this file and milkdownCore.ts,
// the lazy chunk it loads. Cached module-level promise so the engine
// downloads once, on the first note a user actually opens (goal 0244
// S3) -- every OTHER mount reuses the same resolved module.
let corePromise: Promise<CoreModule> | null = null
function loadCore() {
  corePromise ??= import('./milkdownCore')
  return corePromise
}

// A markdown-canonical WYSIWYG surface (goal 0244 S3, ADR-0046): no
// raw `##`/`- [ ]` syntax is ever shown -- Milkdown renders formatted
// content whether or not `onChange` is given, and serializes back to
// markdown source on every edit. `onChange` absent means readonly (a
// resting note's own display), same convention CodeEditor uses. While
// the engine is still loading -- or if it fails to load at all -- this
// renders a plain textarea carrying the same value/onChange/aria-label
// (markdown source, unrendered) so the field is never dead; a resting
// note has no textarea affordance to edit through, so its fallback
// stays a plain read display instead.
export function MilkdownEditor({ value, onChange, ariaLabel, placeholder, testId, onReady }: MilkdownEditorProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const editable = onChange !== undefined
  const [core, setCore] = useState<CoreModule | null>(null)
  // The floating selection toolbar's live handle (goal 0253) -- set
  // once the engine mounts an EDITABLE instance, null otherwise; the
  // React buttons render into its body-level element via portal.
  const [toolbar, setToolbar] = useState<SelectionToolbarHandle | null>(null)
  const [toolbarState, setToolbarState] = useState<SelectionToolbarState>({ bold: false, italic: false, strikethrough: false, code: false })
  // The doc's own draft, updated on every keystroke (markdownUpdated)
  // and read directly by the caller's own commit -- never round-
  // tripped through React state first (testing.md). Refreshed via an
  // effect, per React's own rule against writing a ref during render.
  const onChangeRef = useRef(onChange)
  const onReadyRef = useRef(onReady)
  useEffect(() => {
    onChangeRef.current = onChange
    onReadyRef.current = onReady
  })

  useEffect(() => {
    let cancelled = false
    loadCore()
      .then((mod) => {
        if (!cancelled) setCore(mod)
      })
      .catch(() => {
        console.warn('MilkdownEditor: the Milkdown engine failed to load; staying on the plain-text fallback.')
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!core || !containerRef.current) return
    const { Crepe, NOTE_FEATURES, disableIndentedCodeBlock, taskAtLineStart, configureTaskEnter } = core
    const crepe = new Crepe({
      root: containerRef.current,
      defaultValue: value,
      features: NOTE_FEATURES,
      featureConfigs: placeholder
        ? { [Crepe.Feature.Placeholder]: { text: placeholder } }
        : undefined,
    })
    // Registered on the underlying Editor before create() -- milkdownCore's
    // own $remark extension point, applied here rather than baked into
    // NOTE_FEATURES since it isn't a Crepe feature flag.
    crepe.editor.use(disableIndentedCodeBlock)
    // Line-start to-do shortcut + unchecked Enter-continuation (goal
    // 0254) -- same registration seam.
    crepe.editor.use(taskAtLineStart)
    configureTaskEnter(crepe)
    // The floating selection toolbar (goal 0253): editable mounts
    // only -- a readonly display has no selection to format. Wired
    // before create(), like every plugin registration.
    let toolbarHandle: SelectionToolbarHandle | null = null
    if (editable) {
      toolbarHandle = core.attachSelectionToolbar(crepe, styles.selectionToolbar)
      toolbarHandle.onState(setToolbarState)
      setToolbar(toolbarHandle)
    }
    crepe.on((listener) => {
      listener.markdownUpdated((_ctx, markdown) => {
        onChangeRef.current?.(markdown)
      })
    })
    let destroyed = false
    // create() is async; StrictMode's dev-only double-invoke (mount ->
    // cleanup -> mount) means the cleanup below can run before it
    // resolves. destroy() is only ever called AFTER create() settles
    // -- never synchronously in the cleanup -- so a still-in-flight
    // instance is never torn down mid-construction, which was measured
    // live to corrupt the SURVIVING instance while both raced to mount
    // into the same container.
    const ready = crepe.create().then(() => {
      if (destroyed) return
      crepe.setReadonly(!editable)
      // Exact match, not just [contenteditable]: Milkdown's own
      // widget decorations (e.g. a placeholder node) carry
      // contenteditable="false", which the attribute-presence selector
      // alone would also match.
      const root = containerRef.current?.querySelector<HTMLElement>('[contenteditable="true"]')
      root?.setAttribute('aria-label', ariaLabel)
      onReadyRef.current?.(() => crepe.getMarkdown())
    })
    return () => {
      destroyed = true
      onReadyRef.current?.(undefined)
      setToolbar(null)
      void ready.finally(() => {
        toolbarHandle?.destroy()
        return crepe.destroy()
      })
    }
    // value/ariaLabel/placeholder deliberately excluded: every caller
    // remounts this component fresh for a new edit session or a new
    // note value (AtlasStickyNode/MarkdownNoteField key their read
    // mount by the note's own text) rather than pushing an external
    // value change into a live instance -- matching CodeEditor's own
    // "initial doc set once" contract, one level simpler since there
    // is no controlled-resync case here at all.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [core, editable])

  return (
    <div className={styles.wrapper} data-testid={testId}>
      {!core ? (
        <textarea
          className={styles.fallback}
          value={value}
          aria-label={ariaLabel}
          placeholder={placeholder}
          readOnly={!editable}
          onChange={onChange ? (e) => onChange(e.target.value) : undefined}
        />
      ) : (
        <div ref={containerRef} className={styles.mount} />
      )}
      {toolbar && createPortal(<SelectionToolbarButtons toolbar={toolbar} state={toolbarState} />, toolbar.contentEl)}
    </div>
  )
}

// The floating toolbar's buttons -- portaled into the body-level
// element the kit's TooltipProvider positions (goal 0253). Pointer-
// down is prevented so pressing a button never steals the editor's
// focus/selection out from under the very command it dispatches (the
// selection-toolbar convention Crepe's own buttons also follow).
function SelectionToolbarButtons({ toolbar, state }: { toolbar: SelectionToolbarHandle; state: SelectionToolbarState }) {
  const { t } = useTranslation('common')
  const items: { action: SelectionToolbarAction; icon: typeof BoldIcon; label: string }[] = [
    { action: 'bold', icon: BoldIcon, label: t('formattingToolbar.bold') },
    { action: 'italic', icon: ItalicIcon, label: t('formattingToolbar.italic') },
    { action: 'strikethrough', icon: StrikethroughIcon, label: t('formattingToolbar.strikethrough') },
    { action: 'code', icon: CodeIcon, label: t('formattingToolbar.code') },
  ]
  return (
    <>
      {items.map(({ action, icon, label }) => (
        <IconButton
          key={action}
          icon={icon}
          size="small"
          variant="invisible"
          aria-label={label}
          aria-pressed={state[action]}
          data-testid={`milkdown-toolbar-${action}`}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => toolbar.run(action)}
        />
      ))}
    </>
  )
}
