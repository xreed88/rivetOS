/**
 * Hub state — the per-user document that carries RivetHub's client-side
 * organisation (projects, which session sits in which project, custom names,
 * archive, last open session) across devices. Den stores it on the entry node
 * (`GET`/`PUT /api/hub/state`); desktop and Android keep a local cache.
 *
 * Every per-session key is `${nodeId}::${sessionKey}`: the den node id plus
 * the harness session key. Never a base URL — the phone reaches the same node
 * by a different URL than desktop does, so URL-based keys never match.
 */

import { HARNESS_IDS, type HarnessId } from './harness.js'
import type { ThinkingLevel } from './provider.js'

/** Optional starting point for sessions started inside a project. */
export interface HubProjectDefaults {
  agentId?: string
  model?: string
  effort?: ThinkingLevel
  harnessId?: HarnessId
  /** Den node id. Not a URL. */
  node?: string
  /** Absolute working directory on `node`. */
  directory?: string
}

export interface HubProject {
  id: string
  name: string
  order: number
  createdAt: number
  defaults?: HubProjectDefaults
}

export interface HubLastSession {
  /** `${nodeId}::${sessionKey}` */
  key: string
  /** Epoch ms. */
  at: number
}

export interface HubState {
  projects: HubProject[]
  defaultProjectId?: string
  /** Session key → project id. Key order is oldest → newest. */
  membership: Record<string, string>
  /** Session key → custom name. */
  names: Record<string, string>
  /** Session keys, oldest archived first. */
  archived: string[]
  /** Session keys pinned to the top of the list. */
  pinned: string[]
  /** Session keys hidden from the list (not archived). */
  hidden: string[]
  /** Session key → the user's explicit chat/terminal choice. */
  modes: Record<string, HubSessionMode>
  lastSession?: HubLastSession
}

export type HubSessionMode = 'chat' | 'terminal'

/** `GET /api/hub/state`, and the body of a `409` on `PUT`. */
export interface HubStateResponse {
  /** 0 until the first successful PUT. */
  version: number
  state: HubState
}

/** `PUT /api/hub/state`. `baseVersion` is the version the edit started from. */
export interface HubStatePutRequest {
  baseVersion: number
  state: HubState
}

/**
 * `200` answer to a PUT. `state` is the stored, normalised document, which
 * can differ from what was sent (dropped malformed entries, pruned
 * membership of unknown projects).
 */
export type HubStatePutResponse = HubStateResponse

/** Same limits the desktop stores already apply locally. */
export const HUB_STATE_LIMITS = {
  projects: 200,
  membership: 2000,
  names: 500,
  archived: 1000,
  pinned: 500,
  hidden: 1000,
  modes: 500,
  textLength: 200,
  directoryLength: 4096,
} as const

const SEP = '::'
const THINKING_LEVELS: readonly string[] = ['off', 'low', 'medium', 'high', 'xhigh']

export function hubSessionKey(nodeId: string, sessionKey: string): string {
  return `${nodeId}${SEP}${sessionKey}`
}

/** Splits on the first `::` — session keys may themselves contain `::`. */
export function parseHubSessionKey(key: string): { nodeId: string; sessionKey: string } | null {
  const at = key.indexOf(SEP)
  if (at <= 0) return null
  const sessionKey = key.slice(at + SEP.length)
  return sessionKey ? { nodeId: key.slice(0, at), sessionKey } : null
}

export function emptyHubState(): HubState {
  return {
    projects: [],
    membership: {},
    names: {},
    archived: [],
    pinned: [],
    hidden: [],
    modes: {},
  }
}

export type HubStateNormalizeResult = { ok: true; state: HubState } | { ok: false; error: string }

/**
 * Validate an untrusted document. Malformed entries are dropped; a document
 * over a cap is refused outright, because silently truncating would lose a
 * device's edits without telling it.
 */
export function normalizeHubState(raw: unknown): HubStateNormalizeResult {
  if (!isPlainObject(raw)) return { ok: false, error: 'state must be an object' }

  const rawProjects = raw.projects ?? []
  if (!Array.isArray(rawProjects)) return { ok: false, error: 'projects must be an array' }
  if (rawProjects.length > HUB_STATE_LIMITS.projects)
    return { ok: false, error: `too many projects (max ${HUB_STATE_LIMITS.projects})` }
  const projects: HubProject[] = []
  const ids = new Set<string>()
  for (const entry of rawProjects) {
    const project = normalizeProject(entry)
    if (!project || ids.has(project.id)) continue
    ids.add(project.id)
    projects.push(project)
  }

  const placed = normalizeKeyedStrings(raw.membership, HUB_STATE_LIMITS.membership)
  if (placed === 'over') return overCap('membership', HUB_STATE_LIMITS.membership)
  const membership = Object.fromEntries(
    Object.entries(placed).filter(([, projectId]) => ids.has(projectId)),
  )

  const names = normalizeKeyedStrings(raw.names, HUB_STATE_LIMITS.names)
  if (names === 'over') return overCap('names', HUB_STATE_LIMITS.names)

  const archived = normalizeKeyList(raw.archived, 'archived')
  if (typeof archived === 'string') return { ok: false, error: archived }
  const pinned = normalizeKeyList(raw.pinned, 'pinned')
  if (typeof pinned === 'string') return { ok: false, error: pinned }
  const hidden = normalizeKeyList(raw.hidden, 'hidden')
  if (typeof hidden === 'string') return { ok: false, error: hidden }

  const rawModes = normalizeKeyedStrings(raw.modes, HUB_STATE_LIMITS.modes)
  if (rawModes === 'over') return overCap('modes', HUB_STATE_LIMITS.modes)
  const modes = Object.fromEntries(
    Object.entries(rawModes).filter(([, mode]) => mode === 'chat' || mode === 'terminal'),
  ) as Record<string, HubSessionMode>

  const state: HubState = { projects, membership, names, archived, pinned, hidden, modes }
  const defaultProjectId = text(raw.defaultProjectId)
  if (defaultProjectId && ids.has(defaultProjectId)) state.defaultProjectId = defaultProjectId
  if (isPlainObject(raw.lastSession)) {
    const { key, at } = raw.lastSession
    if (typeof key === 'string' && isHubKey(key) && isTimestamp(at)) state.lastSession = { key, at }
  }
  return { ok: true, state }
}

/**
 * Three-way merge for a 409 or a fresh fetch. `base` is the document this
 * device last synced, `local` its current edits, `remote` the server copy.
 * Per entry: whatever this device changed since `base` wins (including a
 * removal); everything else follows `remote`. Two devices editing different
 * entries therefore never lose each other's work. The result is pruned
 * (membership of removed projects) and capped, oldest first.
 */
export function mergeHubState(base: HubState, local: HubState, remote: HubState): HubState {
  const projects = mergeById(base.projects, local.projects, remote.projects)
  const ids = new Set(projects.map((p) => p.id))
  const membership = Object.fromEntries(
    Object.entries(mergeMap(base.membership, local.membership, remote.membership)).filter(
      ([, projectId]) => ids.has(projectId),
    ),
  )
  const merged: HubState = {
    projects: projects.slice(-HUB_STATE_LIMITS.projects),
    membership: capMap(membership, HUB_STATE_LIMITS.membership),
    names: capMap(mergeMap(base.names, local.names, remote.names), HUB_STATE_LIMITS.names),
    modes: capMap(mergeMap(base.modes, local.modes, remote.modes), HUB_STATE_LIMITS.modes),
    archived: mergeList(base.archived, local.archived, remote.archived).slice(
      -HUB_STATE_LIMITS.archived,
    ),
    pinned: mergeList(base.pinned, local.pinned, remote.pinned).slice(-HUB_STATE_LIMITS.pinned),
    hidden: mergeList(base.hidden, local.hidden, remote.hidden).slice(-HUB_STATE_LIMITS.hidden),
  }
  const defaultProjectId = pick(
    base.defaultProjectId,
    local.defaultProjectId,
    remote.defaultProjectId,
  )
  if (defaultProjectId && ids.has(defaultProjectId)) merged.defaultProjectId = defaultProjectId
  const lastSession = mergeLastSession(base.lastSession, local.lastSession, remote.lastSession)
  if (lastSession) merged.lastSession = lastSession
  return merged
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

function pick<T>(base: T, local: T, remote: T): T {
  return same(local, base) ? remote : local
}

function mergeMap<V>(
  base: Record<string, V>,
  local: Record<string, V>,
  remote: Record<string, V>,
): Record<string, V> {
  const out: Record<string, V> = {}
  // remote order first, then keys only this device added — keeps recency order
  const keys = new Set([...Object.keys(remote), ...Object.keys(local)])
  for (const key of keys) {
    const value = pick(
      Object.hasOwn(base, key) ? base[key] : undefined,
      Object.hasOwn(local, key) ? local[key] : undefined,
      Object.hasOwn(remote, key) ? remote[key] : undefined,
    )
    if (value !== undefined) out[key] = value
  }
  return out
}

function mergeList(base: string[], local: string[], remote: string[]): string[] {
  const b = new Set(base)
  const l = new Set(local)
  const r = new Set(remote)
  const keep = (key: string): boolean => (l.has(key) !== b.has(key) ? l.has(key) : r.has(key))
  return [...new Set([...remote, ...local])].filter(keep)
}

function mergeById(base: HubProject[], local: HubProject[], remote: HubProject[]): HubProject[] {
  const index = (list: HubProject[]) => new Map(list.map((p) => [p.id, p]))
  const b = index(base)
  const l = index(local)
  const r = index(remote)
  const out: HubProject[] = []
  for (const id of new Set([...r.keys(), ...l.keys()])) {
    const project = pick(b.get(id), l.get(id), r.get(id))
    if (project) out.push(project)
  }
  return out
}

/**
 * Latest wins, whatever the base: a device still carrying an older open must
 * never replace a newer one from another device.
 */
function mergeLastSession(
  _base: HubLastSession | undefined,
  local: HubLastSession | undefined,
  remote: HubLastSession | undefined,
): HubLastSession | undefined {
  if (!local) return remote
  if (!remote) return local
  return local.at > remote.at ? local : remote
}

function capMap<V>(map: Record<string, V>, max: number): Record<string, V> {
  const entries = Object.entries(map)
  return entries.length > max ? Object.fromEntries(entries.slice(-max)) : map
}

/**
 * Move every per-session entry from `from` to `to` (a draft key adopted as
 * the harness id). An existing entry under `to` wins over the moved one.
 */
export function rekeyHubState(state: HubState, from: string, to: string): HubState {
  if (from === to) return state
  const move = (map: Record<string, string>): Record<string, string> => {
    if (!Object.hasOwn(map, from)) return map
    const next: Record<string, string> = {}
    for (const [key, value] of Object.entries(map)) if (key !== from) next[key] = value
    if (!Object.hasOwn(next, to)) next[to] = map[from]
    return next
  }
  const swap = (keys: string[]): string[] =>
    keys.includes(from) ? [...new Set(keys.map((k) => (k === from ? to : k)))] : keys
  return {
    ...state,
    membership: move(state.membership),
    names: move(state.names),
    modes: move(state.modes) as Record<string, HubSessionMode>,
    archived: swap(state.archived),
    pinned: swap(state.pinned),
    hidden: swap(state.hidden),
    ...(state.lastSession?.key === from ? { lastSession: { ...state.lastSession, key: to } } : {}),
  }
}

function normalizeProject(raw: unknown): HubProject | null {
  if (!isPlainObject(raw)) return null
  const id = text(raw.id)
  const name = text(raw.name)
  if (!id || !name) return null
  const project: HubProject = {
    id,
    name,
    order: typeof raw.order === 'number' && Number.isFinite(raw.order) ? raw.order : 0,
    createdAt: isTimestamp(raw.createdAt) ? raw.createdAt : 0,
  }
  if (isPlainObject(raw.defaults)) {
    const d = raw.defaults
    const defaults: HubProjectDefaults = {}
    const agentId = text(d.agentId)
    const model = text(d.model)
    const node = text(d.node)
    const directory = path(d.directory)
    if (agentId) defaults.agentId = agentId
    if (model) defaults.model = model
    if (typeof d.effort === 'string' && THINKING_LEVELS.includes(d.effort))
      defaults.effort = d.effort as ThinkingLevel
    if (typeof d.harnessId === 'string' && (HARNESS_IDS as readonly string[]).includes(d.harnessId))
      defaults.harnessId = d.harnessId as HarnessId
    if (node) defaults.node = node
    if (directory) defaults.directory = directory
    if (Object.keys(defaults).length > 0) project.defaults = defaults
  }
  return project
}

function normalizeKeyedStrings(raw: unknown, max: number): Record<string, string> | 'over' {
  if (!isPlainObject(raw)) return {}
  const entries = Object.entries(raw)
  if (entries.length > max) return 'over'
  const out: Record<string, string> = {}
  for (const [key, value] of entries) {
    const v = text(value)
    if (isHubKey(key) && v) out[key] = v
  }
  return out
}

function normalizeKeyList(
  raw: unknown,
  field: 'archived' | 'pinned' | 'hidden',
): string[] | string {
  if (raw === undefined) return []
  if (!Array.isArray(raw)) return `${field} must be an array`
  if (raw.length > HUB_STATE_LIMITS[field])
    return `too many ${field} entries (max ${HUB_STATE_LIMITS[field]})`
  return [...new Set(raw.filter((k): k is string => typeof k === 'string' && isHubKey(k)))]
}

function overCap(field: string, max: number): HubStateNormalizeResult {
  return { ok: false, error: `too many ${field} entries (max ${max})` }
}

function isHubKey(key: string): boolean {
  return key.length <= 1024 && parseHubSessionKey(key) !== null
}

function isTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

/** Trimmed, non-empty text clipped to the cap: a long name is shortened, not lost. */
function text(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim().slice(0, HUB_STATE_LIMITS.textLength).trim()
  return trimmed || undefined
}

/** A path is never clipped: a shortened directory is a different directory. */
function path(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.startsWith('/') && trimmed.length <= HUB_STATE_LIMITS.directoryLength
    ? trimmed
    : undefined
}

function isPlainObject(raw: unknown): raw is Record<string, unknown> {
  return raw !== null && typeof raw === 'object' && !Array.isArray(raw)
}
