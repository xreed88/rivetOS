import { describe, expect, it } from 'vitest'
import {
  HUB_STATE_LIMITS,
  emptyHubState,
  hubSessionKey,
  normalizeHubState,
  parseHubSessionKey,
  rekeyHubState,
  type HubState,
} from './hub-state.js'

const K1 = hubSessionKey('arctic', 'claude-code:abc')
const K2 = hubSessionKey('arctic', 'codex:def')

function normalized(raw: unknown): HubState {
  const res = normalizeHubState(raw)
  if (!res.ok) throw new Error(res.error)
  return res.state
}

describe('hub session keys', () => {
  it('round-trips and splits on the first separator only', () => {
    expect(parseHubSessionKey(hubSessionKey('n1', 'a::b'))).toEqual({
      nodeId: 'n1',
      sessionKey: 'a::b',
    })
    expect(parseHubSessionKey('::abc')).toBeNull()
    expect(parseHubSessionKey('n1::')).toBeNull()
    expect(parseHubSessionKey('https://host:5174/abc')).toBeNull()
  })
})

describe('normalizeHubState', () => {
  it('accepts the empty document and a missing-fields object', () => {
    expect(normalized(emptyHubState())).toEqual(emptyHubState())
    expect(normalized({})).toEqual(emptyHubState())
  })

  it('refuses non-objects and wrong container types', () => {
    expect(normalizeHubState(null).ok).toBe(false)
    expect(normalizeHubState([]).ok).toBe(false)
    expect(normalizeHubState({ projects: {} }).ok).toBe(false)
    expect(normalizeHubState({ archived: 'x' }).ok).toBe(false)
  })

  it('keeps valid project defaults and drops invalid ones', () => {
    const state = normalized({
      projects: [
        {
          id: 'p1',
          name: ' General ',
          order: 0,
          createdAt: 5,
          defaults: {
            agentId: 'rivet',
            effort: 'medium',
            harnessId: 'claude-code',
            node: 'arctic',
            directory: '/home/user/proj',
          },
        },
        {
          id: 'p2',
          name: 'Bad',
          order: 1,
          createdAt: 0,
          defaults: { effort: 'ludicrous', harnessId: 'nope', directory: 'relative/path' },
        },
        { id: 'p1', name: 'duplicate id', order: 2, createdAt: 0 },
        { id: '', name: 'no id' },
      ],
    })
    expect(state.projects).toEqual([
      {
        id: 'p1',
        name: 'General',
        order: 0,
        createdAt: 5,
        defaults: {
          agentId: 'rivet',
          effort: 'medium',
          harnessId: 'claude-code',
          node: 'arctic',
          directory: '/home/user/proj',
        },
      },
      { id: 'p2', name: 'Bad', order: 1, createdAt: 0 },
    ])
  })

  it('prunes membership of unknown projects and drops URL-style keys', () => {
    const state = normalized({
      projects: [{ id: 'p1', name: 'General', order: 0, createdAt: 0 }],
      defaultProjectId: 'gone',
      membership: { [K1]: 'p1', [K2]: 'gone', 'no-separator': 'p1' },
      names: { [K1]: 'My session', [K2]: '   ' },
      archived: [K1, K1, 42, 'no-separator'],
      lastSession: { key: K2, at: 10 },
    })
    expect(state.membership).toEqual({ [K1]: 'p1' })
    expect(state.names).toEqual({ [K1]: 'My session' })
    expect(state.archived).toEqual([K1])
    expect(state.defaultProjectId).toBeUndefined()
    expect(state.lastSession).toEqual({ key: K2, at: 10 })
  })

  it('keeps pins, hidden and modes, dropping unknown modes', () => {
    const state = normalized({
      pinned: [K1, K1, 'no-separator'],
      hidden: [K2],
      modes: { [K1]: 'terminal', [K2]: 'chat', 'arctic::x': 'split' },
    })
    expect(state.pinned).toEqual([K1])
    expect(state.hidden).toEqual([K2])
    expect(state.modes).toEqual({ [K1]: 'terminal', [K2]: 'chat' })
    expect(normalizeHubState({ pinned: 'x' })).toEqual({
      ok: false,
      error: 'pinned must be an array',
    })
  })

  it('refuses a document over a cap instead of truncating it', () => {
    const names: Record<string, string> = {}
    for (let i = 0; i <= HUB_STATE_LIMITS.names; i++) names[hubSessionKey('n', `s${i}`)] = 'x'
    const res = normalizeHubState({ names })
    expect(res).toEqual({
      ok: false,
      error: `too many names entries (max ${HUB_STATE_LIMITS.names})`,
    })
  })
})

describe('rekeyHubState', () => {
  it('moves every per-session entry to the adopted key', () => {
    const state: HubState = {
      projects: [{ id: 'p1', name: 'General', order: 0, createdAt: 0 }],
      membership: { [K1]: 'p1' },
      names: { [K1]: 'draft' },
      archived: [K1],
      pinned: [K1],
      hidden: [K1],
      modes: { [K1]: 'terminal' },
      lastSession: { key: K1, at: 1 },
    }
    expect(rekeyHubState(state, K1, K2)).toEqual({
      ...state,
      membership: { [K2]: 'p1' },
      names: { [K2]: 'draft' },
      archived: [K2],
      pinned: [K2],
      hidden: [K2],
      modes: { [K2]: 'terminal' },
      lastSession: { key: K2, at: 1 },
    })
  })

  it('keeps an existing entry under the target key', () => {
    const state: HubState = { ...emptyHubState(), names: { [K1]: 'old', [K2]: 'kept' } }
    expect(rekeyHubState(state, K1, K2).names).toEqual({ [K2]: 'kept' })
  })
})
