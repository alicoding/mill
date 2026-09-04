/*
 * Mill patch on the vendored pdf.js viewer (goal 0271).
 *
 * WebKit ships no ReadableStream async iteration: the prototype has
 * neither `values` nor `Symbol.asyncIterator`. pdf.js's
 * PDFPageProxy.getTextContent does `for await (const value of
 * readableStream)` over the stream streamTextContent returns, so on
 * macOS's real WKWebView that call throws "undefined is not a
 * function" and the find controller extracts no text at all --
 * every query reports zero matches. Chromium and Firefox both
 * implement the getter, which is why every browser-based layer
 * passes.
 *
 * The vendor ships no compatibility artifact that closes this: the
 * same-version legacy build carries the identical untransformed
 * `for await` and no stream polyfill of its own. This is the
 * WHATWG-specified reader-based implementation (ReadableStream's
 * `values()` / `[Symbol.asyncIterator]`), defined only when the
 * engine lacks it, so an engine that has one keeps its own.
 *
 * Loaded as an external classic script rather than inline: the
 * viewer document's own Content-Security-Policy is
 * `script-src 'self'`, which blocks inline script. A classic script
 * runs before the deferred module scripts that follow it, so the
 * definition is in place before pdf.mjs evaluates.
 *
 * Re-apply this file and its viewer.html <script> tag whenever the
 * vendored pdf.js is upgraded.
 */
;(function () {
  'use strict'
  if (typeof ReadableStream === 'undefined') {
    return
  }
  if (ReadableStream.prototype[Symbol.asyncIterator]) {
    return
  }

  function values(options) {
    var preventCancel = !!(options && options.preventCancel)
    var reader = this.getReader()
    return {
      next: function () {
        return reader.read().then(
          function (result) {
            if (result.done) {
              reader.releaseLock()
            }
            return result
          },
          function (reason) {
            reader.releaseLock()
            throw reason
          },
        )
      },
      return: function (value) {
        if (preventCancel) {
          reader.releaseLock()
          return Promise.resolve({ done: true, value: value })
        }
        var cancelled = reader.cancel(value)
        reader.releaseLock()
        return cancelled.then(function () {
          return { done: true, value: value }
        })
      },
      [Symbol.asyncIterator]: function () {
        return this
      },
    }
  }

  Object.defineProperty(ReadableStream.prototype, 'values', {
    value: values,
    writable: true,
    configurable: true,
  })
  Object.defineProperty(ReadableStream.prototype, Symbol.asyncIterator, {
    value: values,
    writable: true,
    configurable: true,
  })
})()
