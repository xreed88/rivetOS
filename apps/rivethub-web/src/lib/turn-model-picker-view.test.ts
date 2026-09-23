import { describe, expect, it } from 'vitest'
import { buildPickerView, TAIL_INLINE } from './turn-model-picker-view.js'
import type { SelectOption } from '../components/select.js'

function opts(ids: string[]): SelectOption[] {
  return ids.map((id) => ({ value: id, label: id.replace(/^\w+\//, '').replace(/-/g, ' ') }))
}

const claude = opts(['fable', 'opus', 'sonnet', 'haiku', 'fable-1m', 'opus-1m', 'sonnet-1m'])

describe('buildPickerView', () => {
  it('puts a both-pinned-and-recent id only in pinned', () => {
    const v = buildPickerView({
      options: claude,
      value: '',
      defaultLabel: 'Session default (Opus 5)',
      pinnedIds: ['opus'],
      recentIds: ['opus', 'haiku'],
      query: '',
    })
    expect(v.pinned.map((r) => r.id)).toEqual(['opus'])
    expect(v.recent.map((r) => r.id)).toEqual(['haiku'])
    expect(v.allInline.map((r) => r.id).includes('opus')).toBe(false)
    expect(v.allInline.map((r) => r.id).includes('haiku')).toBe(false)
  })

  it('keeps pinned, recent, and all disjoint and never includes empty id', () => {
    const v = buildPickerView({
      options: claude,
      value: 'sonnet',
      defaultLabel: 'Harness default',
      pinnedIds: ['opus', ''],
      recentIds: ['haiku', 'opus', ''],
      query: '',
    })
    const ids = [...v.pinned, ...v.recent, ...v.allInline, ...v.allRest].map((r) => r.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.includes('')).toBe(false)
  })

  it('splits all at TAIL_INLINE', () => {
    const small = buildPickerView({
      options: claude,
      value: '',
      defaultLabel: 'd',
      pinnedIds: [],
      recentIds: [],
      query: '',
    })
    expect(small.allInline).toHaveLength(TAIL_INLINE)
    expect(small.allRest.length).toBe(claude.length - TAIL_INLINE)
    expect(small.allRest.length).toBeLessThan(4)

    const bigOpts = opts(Array.from({ length: 42 }, (_, i) => `m${i}`))
    const big = buildPickerView({
      options: bigOpts,
      value: '',
      defaultLabel: 'd',
      pinnedIds: [],
      recentIds: [],
      query: '',
    })
    expect(big.allInline).toHaveLength(TAIL_INLINE)
    expect(big.allRest.length).toBe(42 - TAIL_INLINE)
    expect(big.allRest.length).toBeGreaterThan(10)
  })

  it('drops unknown pinned and recent ids', () => {
    const v = buildPickerView({
      options: claude,
      value: '',
      defaultLabel: 'd',
      pinnedIds: ['gone', 'opus'],
      recentIds: ['missing', 'haiku'],
      query: '',
    })
    expect(v.pinned.map((r) => r.id)).toEqual(['opus'])
    expect(v.recent.map((r) => r.id)).toEqual(['haiku'])
  })

  it('isEmpty iff no pins and no recents', () => {
    expect(
      buildPickerView({
        options: claude,
        value: '',
        defaultLabel: 'd',
        pinnedIds: [],
        recentIds: [],
        query: '',
      }).isEmpty,
    ).toBe(true)
    expect(
      buildPickerView({
        options: claude,
        value: '',
        defaultLabel: 'd',
        pinnedIds: ['gone'],
        recentIds: [],
        query: '',
      }).isEmpty,
    ).toBe(true)
    expect(
      buildPickerView({
        options: claude,
        value: '',
        defaultLabel: 'd',
        pinnedIds: ['opus'],
        recentIds: [],
        query: '',
      }).isEmpty,
    ).toBe(false)
  })

  it('ranks search prefix-label then prefix-id then substring', () => {
    const options: SelectOption[] = [
      { value: 'other/son-sub', label: 'Other' },
      { value: 'sonnet-id', label: 'Haiku' },
      { value: 'x', label: 'Sonnet 5' },
    ]
    const v = buildPickerView({
      options,
      value: '',
      defaultLabel: 'd',
      pinnedIds: ['x'],
      recentIds: [],
      query: 'son',
    })
    expect(v.searching).toBe(true)
    expect(v.matches.map((r) => r.id)).toEqual(['x', 'sonnet-id', 'other/son-sub'])
    expect(v.matches.find((r) => r.id === 'x')?.pinned).toBe(true)
    expect(v.matches).toHaveLength(3)
  })

  it('empty query is not searching', () => {
    const v = buildPickerView({
      options: claude,
      value: '',
      defaultLabel: 'd',
      pinnedIds: [],
      recentIds: [],
      query: '   ',
    })
    expect(v.searching).toBe(false)
    expect(v.matches).toEqual([])
  })

  it('defaultRow.active when value is empty', () => {
    expect(
      buildPickerView({
        options: claude,
        value: '',
        defaultLabel: 'Session default (Opus 5)',
        pinnedIds: [],
        recentIds: [],
        query: '',
      }).defaultRow.active,
    ).toBe(true)
    expect(
      buildPickerView({
        options: claude,
        value: 'opus',
        defaultLabel: 'Session default (Opus 5)',
        pinnedIds: [],
        recentIds: [],
        query: '',
      }).defaultRow.active,
    ).toBe(false)
  })

  it('promotes a current pick that would fall in allRest to the end of allInline', () => {
    const v = buildPickerView({
      options: claude,
      value: 'sonnet-1m',
      defaultLabel: 'd',
      pinnedIds: [],
      recentIds: [],
      query: '',
    })
    expect(v.allInline.map((r) => r.id).at(-1)).toBe('sonnet-1m')
    expect(v.allRest.map((r) => r.id).includes('sonnet-1m')).toBe(false)
    expect(v.allInline.map((r) => r.id).slice(0, TAIL_INLINE)).toEqual(
      claude.slice(0, TAIL_INLINE).map((o) => o.value),
    )
  })
})
