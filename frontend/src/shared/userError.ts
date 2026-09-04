import i18n from 'i18next'

// The one reader of a bound-method failure (goal 0339). A Wails bound
// method's rejection arrives as a RuntimeError whose `message` is the
// whole Go `%w` chain and whose `cause` is whatever the service's
// error marshaller emitted. Mill's marshaller emits a code and one
// user-facing sentence for a declared failure, and the generic pair for
// anything else -- so `cause` is the only field this file trusts, and
// the chain in `message` never reaches a surface.

// The code every failure that declared none arrives as.
export const UNEXPECTED_CODE = 'unexpected'

export interface UserError {
  // The stable handle a surface branches on. Never rendered.
  code: string
  // The sentence the server chose for this failure, used when the app
  // has no wording of its own for the code.
  message: string
}

// userErrorFrom reads the code/message pair off a rejection. A value
// with no marshalled cause (a frontend-thrown Error, a string) has no
// code, so it reports UNEXPECTED_CODE and carries its own text as the
// message -- messageFor is what decides whether that text is ever shown.
export function userErrorFrom(err: unknown): UserError {
  const cause = (err as { cause?: unknown } | null)?.cause
  if (cause !== null && typeof cause === 'object') {
    const { code, message } = cause as { code?: unknown; message?: unknown }
    if (typeof code === 'string' && code !== '') {
      return { code, message: typeof message === 'string' ? message : '' }
    }
  }
  return { code: UNEXPECTED_CODE, message: err instanceof Error ? err.message : String(err) }
}

// The shape of i18next's t, narrowed to what messageFor needs, so the
// mapping stays a pure function testable without an i18n instance. A
// missing key answers with the empty defaultValue.
export type Translate = (key: string, options: { defaultValue: string }) => string

// messageFor picks the sentence a surface shows: the app's own wording
// for the code when it has one (translatable, and the only place the
// wording can be changed), else the sentence the server sent. The
// rejection's own `message` is never the answer when a code is present
// -- that is the chain this whole path exists to keep out of the UI.
// appTranslate is the app's own wording, for a caller that is not a
// component and so has no useTranslation() hook. An uninitialized
// i18next answers undefined rather than the declared default.
export const appTranslate: Translate = (key, options) => i18n.t(key, options) ?? options.defaultValue

export function messageFor(err: unknown, t: Translate): string {
  return messageOf(userErrorFrom(err), t)
}

// messageOf is messageFor for a pair a surface already holds (a store
// that kept the last failure rather than the rejection). The key is
// namespace-qualified so any surface's own t reaches it.
export function messageOf({ code, message }: UserError, t: Translate): string {
  const translated = t(`common:errors.${code}`, { defaultValue: '' })
  if (translated) return translated
  // No app wording for this code: the sentence the server chose. It is
  // never the chain -- a marshalled cause always carries a code, and
  // without one this is a rejection thrown on this side, whose own
  // message is already copy.
  return message || t(`common:errors.${UNEXPECTED_CODE}`, { defaultValue: '' })
}
