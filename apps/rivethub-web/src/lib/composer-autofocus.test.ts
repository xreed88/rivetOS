import { describe, expect, it } from 'vitest'
import { shouldAutofocusComposer } from './composer-autofocus.js'

// All guards satisfied — the one case that focuses.
const focusable = {
  connected: true,
  alreadyFocusedForSession: false,
  coarsePointer: false,
  otherElementHasFocus: false,
}

describe('shouldAutofocusComposer', () => {
  it('focuses once connected with a fine pointer and nothing else focused', () => {
    expect(shouldAutofocusComposer(focusable)).toBe(true)
  })

  it('waits while the socket is reconnecting', () => {
    expect(shouldAutofocusComposer({ ...focusable, connected: false })).toBe(false)
  })

  it('fires only once per session', () => {
    expect(shouldAutofocusComposer({ ...focusable, alreadyFocusedForSession: true })).toBe(false)
  })

  it('skips touch devices so a tap cannot raise the keyboard over the transcript', () => {
    expect(shouldAutofocusComposer({ ...focusable, coarsePointer: true })).toBe(false)
  })

  it('never pulls focus from something the user is already using', () => {
    expect(shouldAutofocusComposer({ ...focusable, otherElementHasFocus: true })).toBe(false)
  })

  it('stays out when several guards trip at once', () => {
    expect(
      shouldAutofocusComposer({
        connected: false,
        alreadyFocusedForSession: true,
        coarsePointer: true,
        otherElementHasFocus: true,
      }),
    ).toBe(false)
  })
})
