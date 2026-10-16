/**
 * Desktop ↔ hub state document. Desktop keys per-session state as
 * `${baseUrl}::${sessionKey}`; the shared document keys it as
 * `${nodeId}::${sessionKey}`, where the node id is the den's `/healthz.node`
 * (mesh node name). The phone reaches the same node by another URL, so only
 * the node id can match across devices.
 *
 * Neither direction may lose what it cannot translate:
 * - a local entry whose URL has no known node id stays local-only;
 * - a document entry for a node this desktop has no URL for is carried over
 *   from the last-synced document untouched (desktop cannot have edited it).
 */

import {
  hubSessionKey,
  parseHubSessionKey,
  type HubProject,
  type HubProjectDefaults,
  type HubSessionMode,
  type HubState,
} from '@rivetos/types'
import { DEFAULT_SPACE_NAME, type SpaceDef, type SpaceDefaults } from '../stores/spaces.js'

/** The desktop stores' share of the document, in their own key format. */
export interface LocalHubState {
  spaces: SpaceDef[]
  membership: Record<string, string>
  names: Record<string, string>
  archived: string[]
  modes: Record<string, HubSessionMode>
  /** The session desktop last opened, keyed `${baseUrl}::${sessionKey}`. */
  lastSession?: { key: string; at: number }
}

export interface NodeMap {
  /** Node id for a den base URL, or undefined when unknown. */
  nodeOf(baseUrl: string): string | undefined
  /** The base URL this desktop uses for a node id, or undefined. */
  urlOf(nodeId: string): string | undefined
}

const SEP = '::'

function splitLocal(key: string): { url: string; sessionKey: string } | null {
  const at = key.indexOf(SEP)
  if (at <= 0) return null
  const sessionKey = key.slice(at + SEP.length)
  return sessionKey ? { url: key.slice(0, at), sessionKey } : null
}

/**
 * Build a map from probed `/healthz` results. When several URLs reach one
 * node, `preferred` (the active connection, then roster order) decides which
 * one document entries are filed under locally.
 */
export function buildNodeMap(
  probed: ReadonlyMap<string, string>,
  preferred: readonly string[],
): NodeMap {
  const byNode = new Map<string, string>()
  const order = [...preferred, ...probed.keys()]
  for (const url of order) {
    const node = probed.get(url)
    if (node && !byNode.has(node)) byNode.set(node, url)
  }
  return {
    nodeOf: (url) => probed.get(url),
    urlOf: (node) => byNode.get(node),
  }
}

/** Every base URL the local state mentions — what the sync must probe. */
export function localUrls(local: LocalHubState): string[] {
  const urls = new Set<string>()
  const add = (key: string): void => {
    const parts = splitLocal(key)
    if (parts) urls.add(parts.url)
  }
  Object.keys(local.membership).forEach(add)
  Object.keys(local.names).forEach(add)
  Object.keys(local.modes).forEach(add)
  local.archived.forEach(add)
  if (local.lastSession) add(local.lastSession.key)
  for (const space of local.spaces) if (space.defaults?.node) urls.add(space.defaults.node)
  return [...urls]
}

function toHubKey(key: string, nodes: NodeMap): string | undefined {
  const parts = splitLocal(key)
  if (!parts) return undefined
  const node = nodes.nodeOf(parts.url)
  return node ? hubSessionKey(node, parts.sessionKey) : undefined
}

function toLocalKey(key: string, nodes: NodeMap): string | undefined {
  const parts = parseHubSessionKey(key)
  if (!parts) return undefined
  const url = nodes.urlOf(parts.nodeId)
  return url ? `${url}${SEP}${parts.sessionKey}` : undefined
}

/** Document key for a node this desktop cannot reach: keep it as it was. */
function untranslatable(key: string, nodes: NodeMap): boolean {
  const parts = parseHubSessionKey(key)
  return !!parts && nodes.urlOf(parts.nodeId) === undefined
}

function mapToHub<V>(
  local: Record<string, V>,
  base: Record<string, V>,
  nodes: NodeMap,
): Record<string, V> {
  const out: Record<string, V> = {}
  for (const [key, value] of Object.entries(base)) if (untranslatable(key, nodes)) out[key] = value
  for (const [key, value] of Object.entries(local)) {
    const hubKey = toHubKey(key, nodes)
    if (hubKey) out[hubKey] = value
  }
  return out
}

function listToHub(local: string[], base: string[], nodes: NodeMap): string[] {
  const out = base.filter((key) => untranslatable(key, nodes))
  for (const key of local) {
    const hubKey = toHubKey(key, nodes)
    if (hubKey) out.push(hubKey)
  }
  return [...new Set(out)]
}

/** Local entries whose URL has no node id: never uploaded, never dropped. */
function localOnly<V>(local: Record<string, V>, nodes: NodeMap): Record<string, V> {
  return Object.fromEntries(Object.entries(local).filter(([key]) => !toHubKey(key, nodes)))
}

function mapToLocal<V>(hub: Record<string, V>, nodes: NodeMap): Record<string, V> {
  const out: Record<string, V> = {}
  for (const [key, value] of Object.entries(hub)) {
    const localKey = toLocalKey(key, nodes)
    if (localKey && !Object.hasOwn(out, localKey)) out[localKey] = value
  }
  return out
}

function projectToHub(space: SpaceDef, prior: HubProject | undefined, nodes: NodeMap): HubProject {
  const project: HubProject = {
    id: space.id,
    name: space.name,
    order: space.order,
    createdAt: space.createdAt,
  }
  const d = space.defaults
  const defaults: HubProjectDefaults = {}
  if (d?.agentId) defaults.agentId = d.agentId
  if (d?.model) defaults.model = d.model
  if (d?.effort) defaults.effort = d.effort
  if (d?.harnessId) defaults.harnessId = d.harnessId
  const priorNode = prior?.defaults?.node
  // An unresolvable URL keeps the node the document already had, and so does
  // a node this desktop has no URL for (it could not show it, let alone clear it).
  const node = d?.node
    ? (nodes.nodeOf(d.node) ?? priorNode)
    : priorNode && !nodes.urlOf(priorNode)
      ? priorNode
      : undefined
  if (node) defaults.node = node
  // desktop has no directory field yet: never clear the phone's
  if (prior?.defaults?.directory) defaults.directory = prior.defaults.directory
  if (Object.keys(defaults).length > 0) project.defaults = defaults
  return project
}

function projectToLocal(project: HubProject, nodes: NodeMap): SpaceDef {
  const space: SpaceDef = {
    id: project.id,
    name: project.name,
    order: project.order,
    createdAt: project.createdAt,
  }
  const d = project.defaults
  const defaults: SpaceDefaults = {}
  if (d?.agentId) defaults.agentId = d.agentId
  if (d?.model) defaults.model = d.model
  if (d?.effort) defaults.effort = d.effort
  if (d?.harnessId) defaults.harnessId = d.harnessId
  const url = d?.node ? nodes.urlOf(d.node) : undefined
  if (url) defaults.node = url
  if (Object.keys(defaults).length > 0) space.defaults = defaults
  return space
}

/**
 * Desktop state as a document. Fields desktop does not own (pins, hidden,
 * default project) come from `base`, so a PUT never clears what another
 * device set. The last session is desktop's own open when its node is known.
 */
export function toHubState(local: LocalHubState, base: HubState, nodes: NodeMap): HubState {
  const priorById = new Map(base.projects.map((p) => [p.id, p]))
  const state: HubState = {
    projects: local.spaces.map((space) => projectToHub(space, priorById.get(space.id), nodes)),
    membership: mapToHub(local.membership, base.membership, nodes),
    names: mapToHub(local.names, base.names, nodes),
    modes: mapToHub(local.modes, base.modes, nodes),
    archived: listToHub(local.archived, base.archived, nodes),
    pinned: base.pinned,
    hidden: base.hidden,
  }
  if (base.defaultProjectId) state.defaultProjectId = base.defaultProjectId
  const lastKey = local.lastSession ? toHubKey(local.lastSession.key, nodes) : undefined
  if (local.lastSession && lastKey) state.lastSession = { key: lastKey, at: local.lastSession.at }
  else if (base.lastSession) state.lastSession = base.lastSession
  return state
}

/** The document as desktop state, keeping local-only entries alongside. */
export function fromHubState(hub: HubState, local: LocalHubState, nodes: NodeMap): LocalHubState {
  return {
    spaces: hub.projects.map((project) => projectToLocal(project, nodes)),
    membership: { ...localOnly(local.membership, nodes), ...mapToLocal(hub.membership, nodes) },
    names: { ...localOnly(local.names, nodes), ...mapToLocal(hub.names, nodes) },
    modes: { ...localOnly(local.modes, nodes), ...mapToLocal(hub.modes, nodes) },
    archived: [
      ...new Set([
        ...local.archived.filter((key) => !toHubKey(key, nodes)),
        ...hub.archived.flatMap((key) => toLocalKey(key, nodes) ?? []),
      ]),
    ],
    // desktop never resumes another device's open; its own pointer stays
    ...(local.lastSession ? { lastSession: local.lastSession } : {}),
  }
}

/**
 * The untouched first-run "General" every fresh install seeds. A device
 * joining an existing document drops it so the shared one is not doubled.
 */
export function isSeedOnly(local: LocalHubState): boolean {
  if (local.spaces.length !== 1) return false
  const [only] = local.spaces
  return (
    only.name === DEFAULT_SPACE_NAME &&
    !only.defaults &&
    !Object.values(local.membership).includes(only.id)
  )
}
