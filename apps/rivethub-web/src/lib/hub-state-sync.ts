/**
 * Hub state sync: the desktop stores (spaces, names, archive, session modes)
 * mirrored to the connected den's per-user document (`/api/hub/state`), so
 * the phone sees the same projects, names and archive.
 *
 * localStorage stays the first-paint source and offline cache. Each sync:
 * fetch the document, translate local state to node-id keys, three-way merge
 * against the last document this desktop synced, PUT when the result differs,
 * and on 409 merge again onto the newer copy. The first sync against an empty
 * document (version 0) uploads local state — that is the one-time migration.
 *
 * A den without the route (older build) answers 404: sync goes quiet and the
 * stores stay local-only, as before.
 */

import { emptyHubState, mergeHubState, type HubState, type HubStateResponse } from '@rivetos/types'
import { GatewayError } from '@rivetos/gateway-client'
import { useConnection } from '../stores/connection.js'
import { useArchived } from '../stores/archived.js'
import { useSessionNames } from '../stores/session-names.js'
import { useSpaces, withDefaultSpace } from '../stores/spaces.js'
import {
  buildNodeMap,
  fromHubState,
  isSeedOnly,
  localUrls,
  toHubState,
  type LocalHubState,
  type NodeMap,
} from './hub-state-translate.js'
import { fetchHealthz } from './node-name.js'
import { onSessionModesChange, readSessionModes, replaceSessionModes } from './session-mode.js'

export const HUB_STATE_SYNCED_KEY = 'rivethub.hubState.synced'

const DEBOUNCE_MS = 800
const POLL_MS = 60_000
const MAX_ATTEMPTS = 5

/** The document as last agreed with `authority` (a den node id). */
interface Synced extends HubStateResponse {
  authority: string
}

export function readLocalHubState(): LocalHubState {
  const spaces = useSpaces.getState()
  const names: Record<string, string> = {}
  for (const [key, name] of Object.entries(useSessionNames.getState().byKey)) {
    if (name) names[key] = name
  }
  return {
    spaces: spaces.spaces,
    membership: spaces.membership,
    names,
    archived: useArchived.getState().keys,
    modes: readSessionModes(),
  }
}

function applyLocalHubState(next: LocalHubState): void {
  useSpaces.setState({ spaces: withDefaultSpace(next.spaces), membership: next.membership })
  useSessionNames.setState({ byKey: next.names })
  useArchived.setState({ keys: next.archived })
  replaceSessionModes(next.modes)
}

function loadSynced(): Synced | undefined {
  try {
    const parsed = JSON.parse(localStorage.getItem(HUB_STATE_SYNCED_KEY) ?? 'null') as Synced | null
    return parsed && typeof parsed.authority === 'string' && typeof parsed.version === 'number'
      ? parsed
      : undefined
  } catch {
    return undefined
  }
}

function saveSynced(synced: Synced): void {
  try {
    localStorage.setItem(HUB_STATE_SYNCED_KEY, JSON.stringify(synced))
  } catch {
    /* next sync merges from an empty base: a union, nothing is lost */
  }
}

/** Key order differs between producers (server normaliser, merge, stores). */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical((value as Record<string, unknown>)[key])]),
    )
  }
  return value
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b))
}

/** Node ids for every URL the local state or roster mentions. Cached per URL. */
const probeCache = new Map<string, Promise<string | undefined>>()
async function resolveNodes(local: LocalHubState): Promise<NodeMap> {
  const { baseUrl, roster } = useConnection.getState()
  const preferred = [baseUrl, ...roster.map((node) => node.baseUrl)]
  const urls = [...new Set([...preferred, ...localUrls(local)])].filter((url) =>
    /^https?:\/\//.test(url),
  )
  const probed = new Map<string, string>()
  await Promise.all(
    urls.map(async (url) => {
      let pending = probeCache.get(url)
      if (!pending) {
        pending = fetchHealthz(url)
          .then((probe) => probe.node ?? probe.hostname ?? undefined)
          .catch(() => undefined)
        probeCache.set(url, pending)
        // an unreachable node is retried on a later sync
        void pending.then((node) => {
          if (!node) probeCache.delete(url)
        })
      }
      const node = await pending
      if (node) probed.set(url, node)
    }),
  )
  return buildNodeMap(probed, preferred)
}

export interface HubStateSyncOptions {
  debounceMs?: number
  pollMs?: number
}

/** One sync pass and the triggers around it. Returns the uninstaller. */
export function installHubStateSync(opts: HubStateSyncOptions = {}): () => void {
  let disabledFor: string | undefined // baseUrl whose den has no route
  let running: Promise<void> | undefined
  let again = false
  let applying = false
  let timer: ReturnType<typeof setTimeout> | undefined

  async function pass(): Promise<void> {
    const { gateway, baseUrl } = useConnection.getState()
    if (!baseUrl || disabledFor === baseUrl) return
    let remote: HubStateResponse
    try {
      remote = await gateway.hubState()
    } catch (err) {
      if (err instanceof GatewayError && (err.status === 404 || err.status === 405)) {
        disabledFor = baseUrl
      }
      return
    }
    const local = readLocalHubState()
    const nodes = await resolveNodes(local)
    const authority = nodes.nodeOf(baseUrl)
    if (!authority) return // cannot key anything without the den's own id
    const prior = loadSynced()
    const base: HubState = prior?.authority === authority ? prior.state : emptyHubState()
    // A device joining an existing document must not add a second "General".
    const joining = prior?.authority !== authority && remote.state.projects.length > 0
    const mine = toHubState(
      joining && isSeedOnly(local) ? { ...local, spaces: [] } : local,
      base,
      nodes,
    )

    let agreed: HubStateResponse | undefined
    for (let attempt = 0; attempt < MAX_ATTEMPTS && !agreed; attempt++) {
      const merged = mergeHubState(base, mine, remote.state)
      if (same(merged, remote.state)) {
        agreed = remote
        break
      }
      const res = await gateway.putHubState(remote.version, merged)
      if (res.ok) agreed = res
      else remote = res // someone else saved first: merge onto theirs
    }
    if (!agreed) return
    saveSynced({ authority, version: agreed.version, state: agreed.state })

    // The user edited while we were on the wire: leave their edit alone and
    // go round again; the next pass merges it.
    if (!same(readLocalHubState(), local)) {
      again = true
      return
    }
    const next = fromHubState(agreed.state, local, nodes)
    if (same(next, local)) return
    applying = true
    try {
      applyLocalHubState(next)
    } finally {
      applying = false
    }
  }

  function sync(): void {
    if (running) {
      again = true
      return
    }
    running = pass()
      .catch((err: unknown) => {
        console.warn('[hub-state] sync failed', err)
      })
      .finally(() => {
        running = undefined
        if (again) {
          again = false
          schedule()
        }
      })
  }

  function schedule(): void {
    if (applying) return
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = undefined
      sync()
    }, opts.debounceMs ?? DEBOUNCE_MS)
  }

  const onVisible = (): void => {
    if (document.visibilityState === 'visible') sync()
  }
  const poll = setInterval(() => {
    if (document.visibilityState === 'visible') sync()
  }, opts.pollMs ?? POLL_MS)

  const unsubs = [
    useSpaces.subscribe(schedule),
    useSessionNames.subscribe(schedule),
    useArchived.subscribe(schedule),
    onSessionModesChange(schedule),
    useConnection.subscribe((s, prev) => {
      if (s.baseUrl !== prev.baseUrl || s.transportEpoch !== prev.transportEpoch) sync()
    }),
  ]
  window.addEventListener('focus', sync)
  document.addEventListener('visibilitychange', onVisible)
  sync()

  return () => {
    unsubs.forEach((unsub) => unsub())
    window.removeEventListener('focus', sync)
    document.removeEventListener('visibilitychange', onVisible)
    clearInterval(poll)
    if (timer) clearTimeout(timer)
  }
}
