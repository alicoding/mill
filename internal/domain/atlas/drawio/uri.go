package drawio

import (
	"net/url"
	"strings"
)

// draw.io's compressed and URI wire forms both carry the model through
// JavaScript's encodeURIComponent/decodeURIComponent. Go's net/url has
// no exact equivalent (PathEscape leaves a different unreserved set),
// so the encoder below is written against encodeURIComponent's own
// specified unreserved set: A-Z a-z 0-9 and - _ . ! ~ * ' ( ). Decoding
// is plain percent-decoding, which url.PathUnescape already is.

const uriUnreservedExtra = "-_.!~*'()"

func uriEncode(s string) string {
	var b strings.Builder
	b.Grow(len(s))
	for _, c := range []byte(s) {
		if isURIUnreserved(c) {
			b.WriteByte(c)
			continue
		}
		b.WriteByte('%')
		b.WriteByte(upperHex[c>>4])
		b.WriteByte(upperHex[c&0x0f])
	}
	return b.String()
}

const upperHex = "0123456789ABCDEF"

func isURIUnreserved(c byte) bool {
	switch {
	case c >= 'A' && c <= 'Z', c >= 'a' && c <= 'z', c >= '0' && c <= '9':
		return true
	default:
		return strings.IndexByte(uriUnreservedExtra, c) >= 0
	}
}

func uriDecode(s string) (string, bool) {
	if !strings.Contains(s, "%") {
		return "", false
	}
	out, err := url.PathUnescape(s)
	if err != nil {
		return "", false
	}
	return out, true
}
