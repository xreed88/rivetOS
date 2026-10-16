import { describe, expect, it } from 'vitest'
import { emptyHubState, type HubState } from '@rivetos/types'
import {
  buildNodeMap,
  fromHubState,
  isSeedOnly,
  localUrls,
  toHubState,
  type LocalHubState,
} from './hub-state-translate.js'

const LAN = 'https://192.168.1.5:5174'
const TS = 'https://arctic.tail.ts.net:5174'
const OFFLINE = 'https://gone.local:5174'

// Desktop knows arctic by two URLs (LAN preferred). It has no URL for "pixel".
const nodes = buildNodeMap(
  new Map([
    [TS, 'arctic'],
    [LAN, 'arctic'],
  ]),
  [LAN, TS],
)

const emptyLocal: LocalHubState = { spaces: [], membership: {}, names: {}, archived: [], modes: {} }

describe('toHubState', () => {
  it('rekeys every per-session entry from URL to node id', () => {
    const local: LocalHubState = {
      spaces: [
        { id: 'p1', name: 'Work', order: 0, createdAt: 1, defaults: { node: TS, effort: 'high' } },
      ],
      membership: { [`${LAN}::claude-code:a`]: 'p1' },
      names: { [`${TS}::claude-code:a`]: 'Named over Tailscale' },
      archived: [`${LAN}::codex:b`],
      modes: { [`${LAN}::claude-code:a`]: 'terminal' },
    }
    expect(toHubState(local, emptyHubState(), nodes)).toEqual({
      projects: [
        {
          id: 'p1',
          name: 'Work',
          order: 0,
          createdAt: 1,
          defaults: { node: 'arctic', effort: 'high' },
        },
      ],
      membership: { 'arctic::claude-code:a': 'p1' },
      names: { 'arctic::claude-code:a': 'Named over Tailscale' },
      archived: ['arctic::codex:b'],
      modes: { 'arctic::claude-code:a': 'terminal' },
      pinned: [],
      hidden: [],
    })
  })

  it('never uploads an unresolvable URL and keeps what it cannot see', () => {
    const base: HubState = {
      ...emptyHubState(),
      projects: [
        {
          id: 'p1',
          name: 'Phone project',
          order: 0,
          createdAt: 0,
          defaults: { node: 'pixel', directory: '/home/user/code' },
        },
      ],
      names: { 'pixel::claude-code:z': 'from the phone', 'arctic::claude-code:old': 'gone' },
      pinned: ['arctic::claude-code:a'],
      hidden: ['pixel::claude-code:z'],
      lastSession: { key: 'pixel::claude-code:z', at: 5 },
    }
    const local: LocalHubState = {
      ...emptyLocal,
      spaces: [{ id: 'p1', name: 'Phone project', order: 0, createdAt: 0 }],
      names: { [`${OFFLINE}::claude-code:q`]: 'offline node' },
    }
    const hub = toHubState(local, base, nodes)
    // pixel entries carried, the arctic one desktop removed is gone, offline stays out
    expect(hub.names).toEqual({ 'pixel::claude-code:z': 'from the phone' })
    expect(hub.projects[0].defaults).toEqual({ node: 'pixel', directory: '/home/user/code' })
    expect(hub.pinned).toEqual(base.pinned)
    expect(hub.hidden).toEqual(base.hidden)
    expect(hub.lastSession).toEqual(base.lastSession)
  })
})

describe('fromHubState', () => {
  it('files entries under the preferred URL and keeps local-only ones', () => {
    const hub: HubState = {
      ...emptyHubState(),
      projects: [
        { id: 'p1', name: 'Work', order: 0, createdAt: 0, defaults: { node: 'arctic' } },
        { id: 'p2', name: 'Pixel', order: 1, createdAt: 0, defaults: { node: 'pixel' } },
      ],
      names: { 'arctic::claude-code:a': 'A', 'pixel::claude-code:z': 'Z' },
      archived: ['arctic::codex:b'],
    }
    const local: LocalHubState = {
      ...emptyLocal,
      names: { [`${OFFLINE}::claude-code:q`]: 'offline node', [`${TS}::claude-code:a`]: 'stale' },
    }
    expect(fromHubState(hub, local, nodes)).toEqual({
      spaces: [
        { id: 'p1', name: 'Work', order: 0, createdAt: 0, defaults: { node: LAN } },
        { id: 'p2', name: 'Pixel', order: 1, createdAt: 0 },
      ],
      membership: {},
      names: { [`${OFFLINE}::claude-code:q`]: 'offline node', [`${LAN}::claude-code:a`]: 'A' },
      archived: [`${LAN}::codex:b`],
      modes: {},
    })
  })

  it('round-trips through the document', () => {
    const local: LocalHubState = {
      spaces: [{ id: 'p1', name: 'Work', order: 0, createdAt: 3, defaults: { node: LAN } }],
      membership: { [`${LAN}::claude-code:a`]: 'p1' },
      names: { [`${LAN}::claude-code:a`]: 'A' },
      archived: [`${LAN}::codex:b`],
      modes: { [`${LAN}::claude-code:a`]: 'chat' },
    }
    expect(fromHubState(toHubState(local, emptyHubState(), nodes), local, nodes)).toEqual(local)
  })
})

describe('last session', () => {
  it("shares desktop's own open under its node, else keeps the document's", () => {
    const base: HubState = {
      ...emptyHubState(),
      lastSession: { key: 'pixel::claude-code:z', at: 5 },
    }
    const mine = { ...emptyLocal, lastSession: { key: `${TS}::claude-code:a`, at: 9 } }
    expect(toHubState(mine, base, nodes).lastSession).toEqual({
      key: 'arctic::claude-code:a',
      at: 9,
    })
    const offline = { ...emptyLocal, lastSession: { key: `${OFFLINE}::claude-code:q`, at: 9 } }
    expect(toHubState(offline, base, nodes).lastSession).toEqual(base.lastSession)
    // reading the document never moves desktop's own pointer
    expect(fromHubState(base, mine, nodes).lastSession).toEqual(mine.lastSession)
  })
})

describe('helpers', () => {
  it('lists every URL the local state mentions', () => {
    const local: LocalHubState = {
      ...emptyLocal,
      spaces: [{ id: 'p', name: 'x', order: 0, createdAt: 0, defaults: { node: OFFLINE } }],
      names: { [`${LAN}::a`]: 'n' },
      archived: [`${TS}::b`],
    }
    expect(localUrls(local).sort()).toEqual([LAN, OFFLINE, TS].sort())
  })

  it('recognises the untouched seeded General', () => {
    const seed = { id: 's', name: 'General', order: 0, createdAt: 0 }
    expect(isSeedOnly({ ...emptyLocal, spaces: [seed] })).toBe(true)
    expect(isSeedOnly({ ...emptyLocal, spaces: [seed], membership: { k: 's' } })).toBe(false)
    expect(isSeedOnly({ ...emptyLocal, spaces: [{ ...seed, name: 'Work' }] })).toBe(false)
  })
})
