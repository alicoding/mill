import { useEffect, useState } from 'react'
import { marked } from 'marked'
import { SpecService } from '../bindings/github.com/alicoding/mill'
import styles from './SpecView.module.css'

function SpecView() {
  const [html, setHtml] = useState<string>('Loading spec...')

  useEffect(() => {
    SpecService.Get()
      .then((markdown) => setHtml(marked.parse(markdown, { async: false })))
      .catch((err) => setHtml(`<p class="spec-error">Failed to load spec: ${String(err)}</p>`))
  }, [])

  return (
    <article className={`view-pane ${styles.spec}`} dangerouslySetInnerHTML={{ __html: html }} />
  )
}

export default SpecView
