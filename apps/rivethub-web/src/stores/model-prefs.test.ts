import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  const m = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    get length() {
      return m.size
    },
    clear: () => m.clear(),
    getItem: (k: string) => m.get(k) ?? null,
    key: (i: number) => [...m.keys()][i] ?? null,
    removeItem: (k: string) => void m.delete(k),
    setItem: (k: string, v: string) => void m.set(k, String(v)),
  } satisfies Storage)
})

afterAll(() => vi.unstubAllGlobals())

const { useModelPrefs, computeToggle, computeRecent, RECENT_CAP } = await import('./model-prefs.js')

describe('computeToggle', () => {
  it('appends then removes preserving pin order', () => {
    const a = computeToggle([], 'opus')
    expect(a).toEqual(['opus'])
    const b = computeToggle(a, 'sonnet')
    expect(b).toEqual(['opus', 'sonnet'])
    const c = computeToggle(b, 'haiku')
    expect(c).toEqual(['opus', 'sonnet', 'haiku'])
    expect(computeToggle(c, 'sonnet')).toEqual(['opus', 'haiku'])
  })
})

describe('computeRecent', () => {
  it('unshifts, dedupes, and caps', () => {
    expect(computeRecent([], 'a')).toEqual(['a'])
    expect(computeRecent(['a'], 'b')).toEqual(['b', 'a'])
    expect(computeRecent(['b', 'a'], 'a')).toEqual(['a', 'b'])
    const filled = ['1', '2', '3', '4', '5']
    expect(computeRecent(filled, '6', RECENT_CAP)).toEqual(['6', '1', '2', '3', '4'])
  })
})

describe('model prefs store', () => {
  beforeEach(() => {
    useModelPrefs.setState({ pinned: {}, recent: {} })
    localStorage.removeItem('rivethub.modelPrefs')
  })

  it('togglePin creates and prunes the harness array', () => {
    useModelPrefs.getState().togglePin('claude-code', 'opus')
    expect(useModelPrefs.getState().pinned['claude-code']).toEqual(['opus'])
    useModelPrefs.getState().togglePin('claude-code', 'sonnet')
    expect(useModelPrefs.getState().pinned['claude-code']).toEqual(['opus', 'sonnet'])
    useModelPrefs.getState().togglePin('claude-code', 'opus')
    expect(useModelPrefs.getState().pinned['claude-code']).toEqual(['sonnet'])
    useModelPrefs.getState().togglePin('claude-code', 'sonnet')
    expect(useModelPrefs.getState().pinned['claude-code']).toBeUndefined()
  })

  it('recordRecent ignores empty id', () => {
    useModelPrefs.getState().recordRecent('claude-code', '')
    expect(useModelPrefs.getState().recent['claude-code']).toBeUndefined()
    useModelPrefs.getState().recordRecent('claude-code', 'opus')
    expect(useModelPrefs.getState().recent['claude-code']).toEqual(['opus'])
  })

  it('keeps independent pins and recents per harness', () => {
    useModelPrefs.getState().togglePin('claude-code', 'opus')
    useModelPrefs.getState().togglePin('opencode', 'gpt-5')
    useModelPrefs.getState().recordRecent('claude-code', 'haiku')
    useModelPrefs.getState().recordRecent('opencode', 'gemini')
    expect(useModelPrefs.getState().pinned['claude-code']).toEqual(['opus'])
    expect(useModelPrefs.getState().pinned['opencode']).toEqual(['gpt-5'])
    expect(useModelPrefs.getState().recent['claude-code']).toEqual(['haiku'])
    expect(useModelPrefs.getState().recent['opencode']).toEqual(['gemini'])
  })
})
