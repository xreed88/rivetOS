/** Decide whether to take focus for the composer textarea on this render.
 *
 * The composer autofocuses on landing in a conversation (and on switching to
 * another, since the session subtree remounts per session) so you can type
 * without clicking first. Two guards keep that from hurting:
 *
 *  1. Only take focus when nothing else owns it (`otherElementHasFocus`).
 *     `connected` flips true a beat after render, and in that window the drawer
 *     is interactive — an inline rename commits on blur, the filter input, a
 *     dialog focus trap, an in-progress transcript selection, and a terminal a
 *     legacy row still shows before it flips to Chat must all be left alone.
 *  2. Skip on a coarse pointer (touch): programmatic focus is not suppressed on
 *     Android Chrome/WebView, so a tap that remounts the composer would raise
 *     the keyboard over the transcript. A real tap on the textarea still
 *     focuses it.
 *
 * Also waits for `connected` (the textarea is disabled while the socket
 * reconnects) and fires once per session (`alreadyFocusedForSession`), so a
 * later reconnect can't steal focus mid-scroll.
 */
export function shouldAutofocusComposer(input: {
  connected: boolean
  alreadyFocusedForSession: boolean
  coarsePointer: boolean
  otherElementHasFocus: boolean
}): boolean {
  if (!input.connected) return false
  if (input.alreadyFocusedForSession) return false
  if (input.coarsePointer) return false
  if (input.otherElementHasFocus) return false
  return true
}
