import { useEffect, useState } from 'react'
import { marked } from 'marked'
import { SpecService } from '../bindings/github.com/alicoding/mill'
import CapabilityIndex from './CapabilityIndex'
import CompositionCapabilityMap from './CompositionCapabilityMap'
import styles from './SpecView.module.css'

function SpecView() {
  const [html, setHtml] = useState<string>('Loading spec...')

  useEffect(() => {
    SpecService.Get()
      .then((markdown) => setHtml(marked.parse(markdown, { async: false })))
      .catch((err) => setHtml(`<p class="spec-error">Failed to load spec: ${String(err)}</p>`))
  }, [])

  return (
    <div className={styles.spec}>
      <CapabilityIndex />
      <CompositionCapabilityMap />
      <article dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  )
}

export default SpecView
