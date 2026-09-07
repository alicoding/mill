// Copy-icon/check-icon SVG markup, byte-identical to @primer/octicons-react's
// CopyIcon/CheckIcon 16px path data -- the same icon vocabulary
// CopyDiagnosisButton already uses for every other copy action in the
// app (shared/CopyDiagnosisButton.tsx), inlined as raw markup because
// this button lives inside a dangerouslySetInnerHTML string, not
// React's own tree, so a React icon component can't render here.
export const COPY_ICON_SVG =
  '<svg aria-hidden="true" viewBox="0 0 16 16" width="16" height="16" fill="currentColor">' +
  '<path d="M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 0 1 0 1.5h-1.5a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-1.5a.75.75 0 0 1 1.5 0v1.5A1.75 1.75 0 0 1 9.25 16h-7.5A1.75 1.75 0 0 1 0 14.25Z"></path>' +
  '<path d="M5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0 1 14.25 11h-7.5A1.75 1.75 0 0 1 5 9.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z"></path>' +
  '</svg>'

export const CHECK_ICON_SVG =
  '<svg aria-hidden="true" viewBox="0 0 16 16" width="16" height="16" fill="currentColor">' +
  '<path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.751.751 0 0 1 .018-1.042.751.751 0 0 1 1.042-.018L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z"></path>' +
  '</svg>'

// injectCodeCopyButtons wraps every rendered code block in a
// hover-revealed copy button (goal 0235 S3) -- wrapperClassName drives
// position:relative + the hover-reveal rule, buttonClassName the
// button's own look. The button carries no per-block state of its own;
// DocsView's delegated click handler reads the RAW code text straight
// off the sibling <pre><code> at click time (its .textContent is
// already entity-decoded by the browser) rather than round-tripping it
// through a data attribute. Parsed via DOMParser (goal 0382): moving
// the existing <pre> node into its wrapper keeps every attribute and
// nested tag goldmark emitted, without re-deriving them by hand.
export function injectCodeCopyButtons(
  html: string,
  wrapperClassName: string,
  buttonClassName: string,
  copyLabel: string,
): string {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  for (const code of Array.from(doc.querySelectorAll('pre > code'))) {
    const pre = code.parentElement
    if (!pre || pre.children.length !== 1) continue
    const wrapper = doc.createElement('div')
    wrapper.setAttribute('class', wrapperClassName)
    wrapper.setAttribute('data-testid', 'docs-code-block')
    pre.replaceWith(wrapper)
    wrapper.appendChild(pre)
    const button = doc.createElement('button')
    button.setAttribute('type', 'button')
    button.setAttribute('class', buttonClassName)
    button.setAttribute('data-testid', 'docs-code-copy')
    button.setAttribute('aria-label', copyLabel)
    button.innerHTML = COPY_ICON_SVG
    wrapper.appendChild(button)
  }
  return doc.body.innerHTML
}
