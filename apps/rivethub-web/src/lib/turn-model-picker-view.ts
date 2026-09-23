import type { SelectOption } from '../components/select.js'

export interface PickerRow {
  id: string
  label: string
  pinned: boolean
}

export interface PickerView {
  defaultRow: { label: string; active: boolean }
  searching: boolean
  pinned: PickerRow[]
  recent: PickerRow[]
  allInline: PickerRow[]
  allRest: PickerRow[]
  matches: PickerRow[]
  isEmpty: boolean
}

export const TAIL_INLINE = 4

function row(opt: SelectOption, pinned: boolean): PickerRow {
  return { id: opt.value, label: opt.label, pinned }
}

function rank(opt: SelectOption, q: string): number | null {
  const label = opt.label.toLowerCase()
  const id = opt.value.toLowerCase()
  if (label.startsWith(q)) return 0
  if (id.startsWith(q)) return 1
  if (label.includes(q) || id.includes(q)) return 2
  return null
}

export function buildPickerView(input: {
  options: SelectOption[]
  value: string
  defaultLabel: string
  pinnedIds: string[]
  recentIds: string[]
  query: string
}): PickerView {
  const byId = new Map(input.options.map((o) => [o.value, o]))
  const pinnedSet = new Set<string>()
  const pinned: PickerRow[] = []
  for (const id of input.pinnedIds) {
    const opt = byId.get(id)
    if (!opt || pinnedSet.has(id)) continue
    pinnedSet.add(id)
    pinned.push(row(opt, true))
  }

  const recentSet = new Set<string>()
  const recent: PickerRow[] = []
  for (const id of input.recentIds) {
    if (id === '' || pinnedSet.has(id) || recentSet.has(id)) continue
    const opt = byId.get(id)
    if (!opt) continue
    recentSet.add(id)
    recent.push(row(opt, false))
  }

  const taken = new Set([...pinnedSet, ...recentSet])
  const remainder: PickerRow[] = []
  for (const opt of input.options) {
    if (opt.value === '' || taken.has(opt.value)) continue
    remainder.push(row(opt, false))
  }

  const allInline = remainder.slice(0, TAIL_INLINE)
  const allRest = remainder.slice(TAIL_INLINE)
  const restIdx = allRest.findIndex((r) => r.id === input.value)
  const moved = restIdx >= 0 ? allRest[restIdx] : undefined
  const inline = moved ? [...allInline, moved] : allInline
  const rest = restIdx >= 0 ? allRest.filter((_, i) => i !== restIdx) : allRest

  const q = input.query.trim().toLowerCase()
  const searching = q !== ''
  const matches: PickerRow[] = []
  if (searching) {
    const scored: { row: PickerRow; rank: number; i: number }[] = []
    input.options.forEach((opt, i) => {
      const r = rank(opt, q)
      if (r === null) return
      scored.push({ row: row(opt, pinnedSet.has(opt.value)), rank: r, i })
    })
    scored.sort((a, b) => a.rank - b.rank || a.i - b.i)
    for (const s of scored) matches.push(s.row)
  }

  return {
    defaultRow: { label: input.defaultLabel, active: input.value === '' },
    searching,
    pinned,
    recent,
    allInline: inline,
    allRest: rest,
    matches,
    isEmpty: pinned.length === 0 && recent.length === 0,
  }
}
