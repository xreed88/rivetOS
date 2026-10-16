import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  emptyHubState,
  normalizeHubState,
  type HubState,
  type HubStateResponse,
} from '@rivetos/types'
import { GatewayError } from '@rivetos/gateway-client'

function memoryStorage(): Storage {
  const m = new Map<string, string>()
  return {
    get length() {
      return m.size
    },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, String(v)),
  }
}

const store = memoryStorage()
vi.stubGlobal('localStorage', store)
vi.stubGlobal('window', {
  localStorage: store,
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
})
vi.stubGlobal('document', {
  visibilityState: 'visible',
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
})
afterAll(() => vi.unstubAllGlobals())

const BASE = 'https://arctic.local:5174'

/** In-memory den: the same compare-and-set rules as /api/hub/state. */
class FakeDen {
  doc: HubStateResponse = { version: 0, state: emptyHubState() }
  puts = 0
  missingRoute = false
  /** Runs once before the next PUT is judged — another device saving first. */
  beforePut?: () => void
  hubState = vi.fn(async (): Promise<HubStateResponse> => {
    if (this.missingRoute) throw new GatewayError(404, 'not found', { error: 'not found' })
    return structuredClone(this.doc)
  })
  putHubState = vi.fn(async (baseVersion: number, state: HubState) => {
    this.puts++
    const hook = this.beforePut
    this.beforePut = undefined
    hook?.()
    if (baseVersion !== this.doc.version) return { ok: false, ...structuredClone(this.doc) }
    const res = normalizeHubState(state)
    if (!res.ok) throw new GatewayError(400, res.error, undefined)
    this.doc = { version: this.doc.version + 1, state: res.state }
    return { ok: true, ...structuredClone(this.doc) }
  })
}

let den = new FakeDen()

vi.mock('./node-name.js', () => ({
  fetchHealthz: vi.fn(async (url: string) =>
    url === 'https://arctic.local:5174'
      ? { hostname: 'arctic', node: 'arctic' }
      : { hostname: null, node: null },
  ),
}))
vi.mock('../stores/connection.js', async () => {
  const { create } = await import('zustand')
  return {
    useConnection: create(() => ({
      baseUrl: 'https://arctic.local:5174',
      roster: [],
      transportEpoch: 0,
      gateway: {
        hubState: () => den.hubState(),
        putHubState: (v: number, s: HubState) => den.putHubState(v, s),
      },
    })),
  }
})

const { installHubStateSync, HUB_STATE_SYNCED_KEY } = await import('./hub-state-sync.js')
const { useSpaces } = await import('../stores/spaces.js')
const { useSessionNames } = await import('../stores/session-names.js')
const { useArchived } = await import('../stores/archived.js')
const { getSessionMode, setSessionMode } = await import('./session-mode.js')
const { useChat } = await import('../stores/chat.js')

let uninstall: (() => void) | undefined

beforeEach(() => {
  store.clear()
  den = new FakeDen()
  useSpaces.setState({
    spaces: [{ id: 'seed', name: 'General', order: 0, createdAt: 0 }],
    membership: {},
  })
  useSessionNames.setState({ byKey: {} })
  useArchived.setState({ keys: [] })
})
afterEach(() => {
  uninstall?.()
  uninstall = undefined
})

const start = () => {
  uninstall = installHubStateSync({ debounceMs: 5, pollMs: 60_000 })
}

describe('hub state sync', () => {
  it('uploads local state to an empty document once (migration)', async () => {
    useSpaces.setState({
      spaces: [{ id: 'p1', name: 'Work', order: 0, createdAt: 1 }],
      membership: { [`${BASE}::claude-code:a`]: 'p1' },
    })
    useSessionNames.setState({ byKey: { [`${BASE}::claude-code:a`]: 'Desk name' } })
    setSessionMode(`${BASE}::claude-code:a`, 'terminal')
    start()
    await vi.waitFor(() => expect(den.doc.version).toBe(1))
    expect(den.doc.state).toMatchObject({
      projects: [{ id: 'p1', name: 'Work' }],
      membership: { 'arctic::claude-code:a': 'p1' },
      names: { 'arctic::claude-code:a': 'Desk name' },
      modes: { 'arctic::claude-code:a': 'terminal' },
    })
    expect(JSON.parse(store.getItem(HUB_STATE_SYNCED_KEY) ?? '{}')).toMatchObject({
      authority: 'arctic',
      version: 1,
    })

    // steady state: another pass with nothing changed must not write
    const { useConnection } = await import('../stores/connection.js')
    useConnection.setState({ transportEpoch: 1 })
    await vi.waitFor(() => expect(den.hubState).toHaveBeenCalledTimes(2))
    await new Promise((r) => setTimeout(r, 30))
    expect(den.puts).toBe(1)
  })

  it('a fresh device adopts the shared projects without adding its own General', async () => {
    den.doc = {
      version: 4,
      state: {
        ...emptyHubState(),
        projects: [{ id: 'shared', name: 'General', order: 0, createdAt: 0 }],
        names: { 'arctic::claude-code:a': 'From the phone' },
        archived: ['arctic::codex:b'],
        modes: { 'arctic::claude-code:a': 'terminal' },
      },
    }
    start()
    await vi.waitFor(() => expect(useSpaces.getState().spaces.map((s) => s.id)).toEqual(['shared']))
    expect(den.puts).toBe(0)
    expect(useSessionNames.getState().byKey).toEqual({
      [`${BASE}::claude-code:a`]: 'From the phone',
    })
    expect(useArchived.getState().keys).toEqual([`${BASE}::codex:b`])
    expect(getSessionMode(`${BASE}::claude-code:a`)).toBe('terminal')
  })

  it('merges onto a newer document on 409 instead of overwriting it', async () => {
    start()
    await vi.waitFor(() => expect(den.doc.version).toBe(1))
    // the phone renames another session just before desktop's next PUT lands
    den.beforePut = () => {
      den.doc = {
        version: den.doc.version + 1,
        state: { ...den.doc.state, names: { 'arctic::codex:phone': 'Phone rename' } },
      }
    }
    useSessionNames.getState().set(`${BASE}::claude-code:a`, 'Desk rename')
    await vi.waitFor(() =>
      expect(den.doc.state.names).toEqual({
        'arctic::codex:phone': 'Phone rename',
        'arctic::claude-code:a': 'Desk rename',
      }),
    )
    await vi.waitFor(() =>
      expect(useSessionNames.getState().byKey[`${BASE}::codex:phone`]).toBe('Phone rename'),
    )
  })

  it('shares the session desktop opened as the last session', async () => {
    useChat.setState({ lastActive: { sessionId: 'claude-code:a', baseUrl: BASE, at: 1234 } })
    start()
    await vi.waitFor(() =>
      expect(den.doc.state.lastSession).toEqual({ key: 'arctic::claude-code:a', at: 1234 }),
    )
    useChat.setState({ lastActive: undefined })
  })

  it('stays local-only against a den without the route', async () => {
    den.missingRoute = true
    start()
    await vi.waitFor(() => expect(den.hubState).toHaveBeenCalledTimes(1))
    useSessionNames.getState().set(`${BASE}::claude-code:a`, 'Local')
    await new Promise((r) => setTimeout(r, 30))
    expect(den.hubState).toHaveBeenCalledTimes(1)
    expect(den.puts).toBe(0)
    expect(useSessionNames.getState().byKey).toEqual({ [`${BASE}::claude-code:a`]: 'Local' })
  })
})
