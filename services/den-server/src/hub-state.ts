/**
 * Per-user hub state document (`GET`/`PUT /api/hub/state`). One JSON file per
 * scope under `<stateDir>/hub-state/`, written temp + rename so a crash
 * mid-write never leaves a truncated document behind.
 *
 * Writes are compare-and-set on `version`: a PUT whose `baseVersion` is not
 * the stored version gets the current document back (HTTP 409) and the client
 * merges and retries. get/put are synchronous, so two requests can never
 * interleave between the check and the write.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  emptyHubState,
  normalizeHubState,
  type HubStateResponse,
  type UserContext,
} from '@rivetos/types'

export type HubStatePutResult =
  | ({ ok: true } & HubStateResponse)
  | ({ ok: false; conflict: true } & HubStateResponse)
  | { ok: false; conflict: false; error: string }

export interface HubStateStore {
  get(scope: string): HubStateResponse
  put(scope: string, baseVersion: unknown, state: unknown): HubStatePutResult
}

/**
 * The owner's document lives under one fixed scope whether or not a users
 * registry is configured, so enabling tenancy later does not orphan it.
 * No ctx = tenancy off = the node owner.
 */
export function hubStateScope(ctx: UserContext | undefined): string {
  return !ctx || ctx.isOwner ? 'owner' : `user-${ctx.userId}`
}

export function createHubStateStore(dir: string): HubStateStore {
  const cache = new Map<string, HubStateResponse>()

  function fileOf(scope: string): string {
    // user ids come from the registry, but they still become filenames
    const safe = /^[\w.-]{1,96}$/.test(scope) ? scope : `x-${Buffer.from(scope).toString('hex')}`
    return join(dir, `${safe}.json`)
  }

  function load(scope: string): HubStateResponse {
    const hit = cache.get(scope)
    if (hit) return hit
    const file = fileOf(scope)
    let doc: HubStateResponse = { version: 0, state: emptyHubState() }
    if (existsSync(file)) {
      try {
        const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<HubStateResponse>
        const res = normalizeHubState(parsed.state)
        const version = parsed.version
        if (!res.ok || typeof version !== 'number' || !Number.isSafeInteger(version))
          throw new Error(res.ok ? 'bad version' : res.error)
        doc = { version, state: res.state }
      } catch (err) {
        // keep the unreadable file for inspection; serve a fresh document
        const aside = `${file}.corrupt-${Date.now()}`
        console.error(
          `[den] hub-state "${file}" is unreadable (${err instanceof Error ? err.message : err}) — moved to ${aside}`,
        )
        try {
          renameSync(file, aside)
        } catch {
          /* best effort */
        }
      }
    }
    cache.set(scope, doc)
    return doc
  }

  function persist(scope: string, doc: HubStateResponse): void {
    mkdirSync(dir, { recursive: true })
    const file = fileOf(scope)
    const tmp = `${file}.${process.pid}.tmp`
    writeFileSync(tmp, JSON.stringify(doc, null, 2) + '\n', { mode: 0o600 })
    renameSync(tmp, file)
  }

  return {
    get(scope) {
      return load(scope)
    },
    put(scope, baseVersion, state) {
      if (typeof baseVersion !== 'number' || !Number.isSafeInteger(baseVersion) || baseVersion < 0)
        return { ok: false, conflict: false, error: 'baseVersion must be a non-negative integer' }
      const res = normalizeHubState(state)
      if (!res.ok) return { ok: false, conflict: false, error: res.error }
      const current = load(scope)
      if (baseVersion !== current.version) return { ok: false, conflict: true, ...current }
      const next: HubStateResponse = { version: current.version + 1, state: res.state }
      // persist first: a failed write must not advance the in-memory version
      persist(scope, next)
      cache.set(scope, next)
      return { ok: true, ...next }
    },
  }
}
