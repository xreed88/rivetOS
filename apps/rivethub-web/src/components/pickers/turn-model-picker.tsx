import { useEffect, useMemo, useRef, useState, type JSX, type KeyboardEvent } from 'react'
import { Check, ChevronDown, Cpu, Search, Star, X } from 'lucide-react'
import { cn } from '../../lib/utils.js'
import type { SelectOption } from '../select.js'
import { Button } from '../ui/button.js'
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from '../ui/popover.js'
import { buildPickerView, type PickerRow } from '../../lib/turn-model-picker-view.js'
import { NO_IDS, useModelPrefs } from '../../stores/model-prefs.js'

export function TurnModelPicker(props: {
  value: string
  options: SelectOption[]
  defaultLabel: string
  onChange: (value: string) => void
  harnessId?: string
  disabled?: boolean
  className?: string
}): JSX.Element {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [showAll, setShowAll] = useState(false)
  const [highlight, setHighlight] = useState(0)
  const searchRef = useRef<HTMLInputElement>(null)

  const pinnedIds = useModelPrefs(
    (s) => (props.harnessId ? s.pinned[props.harnessId] : undefined) ?? NO_IDS,
  )
  const recentIds = useModelPrefs(
    (s) => (props.harnessId ? s.recent[props.harnessId] : undefined) ?? NO_IDS,
  )
  const togglePin = useModelPrefs((s) => s.togglePin)

  const view = useMemo(
    () =>
      buildPickerView({
        options: props.options,
        value: props.value,
        defaultLabel: props.defaultLabel,
        pinnedIds: props.harnessId ? [...pinnedIds] : [],
        recentIds: props.harnessId ? [...recentIds] : [],
        query,
      }),
    [props.options, props.value, props.defaultLabel, props.harnessId, pinnedIds, recentIds, query],
  )

  const currentLabel =
    props.value === ''
      ? props.defaultLabel
      : (props.options.find((o) => o.value === props.value)?.label ?? props.defaultLabel)

  const visibleIds = useMemo(() => {
    if (view.searching) return view.matches.map((r) => r.id)
    const ids = ['']
    for (const r of view.pinned) ids.push(r.id)
    for (const r of view.recent) ids.push(r.id)
    for (const r of view.allInline) ids.push(r.id)
    if (showAll) for (const r of view.allRest) ids.push(r.id)
    return ids
  }, [view, showAll])

  useEffect(() => {
    if (!open) return
    setQuery('')
    setShowAll(false)
    searchRef.current?.focus()
  }, [open])

  useEffect(() => {
    if (view.searching) {
      setHighlight(0)
      return
    }
    const i = visibleIds.indexOf(props.value)
    setHighlight(i >= 0 ? i : 0)
  }, [view.searching, query, open])

  // Keep the keyboard highlight visible in a long (scrolling) list.
  const listRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    listRef.current?.querySelector('[data-hi]')?.scrollIntoView({ block: 'nearest' })
  }, [highlight])

  function pick(id: string) {
    props.onChange(id)
    setOpen(false)
  }

  function onSearchKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlight((h) => Math.min(h + 1, Math.max(visibleIds.length - 1, 0)))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlight((h) => Math.max(h - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (highlight < visibleIds.length) pick(visibleIds[highlight])
    } else if (e.key === 'Escape') {
      if (query) {
        e.preventDefault()
        e.stopPropagation()
        setQuery('')
      }
    }
  }

  function zone(title: string, rows: PickerRow[]) {
    if (rows.length === 0) return null
    return (
      <div>
        <div className="px-2.5 py-1 text-[10px] font-medium uppercase tracking-wide text-ink-dim">
          {title}
        </div>
        {rows.map((r) => modelRow(r))}
      </div>
    )
  }

  function modelRow(r: PickerRow) {
    const i = visibleIds.indexOf(r.id)
    const active = r.id === props.value
    const hi = i === highlight
    return (
      <div
        key={r.id}
        data-hi={hi || undefined}
        className={cn('flex w-full items-center rounded-md', hi ? 'bg-panel' : '')}
      >
        <button
          type="button"
          onClick={() => pick(r.id)}
          className={cn(
            'flex min-w-0 flex-1 items-center gap-2 px-2.5 py-1.5 text-left text-sm',
            active ? 'text-ink' : 'text-ink-dim hover:text-ink',
          )}
        >
          <span className="min-w-0 flex-1 truncate">{r.label}</span>
          {active && <Check className="size-3.5 shrink-0 text-em" />}
        </button>
        {props.harnessId && (
          <button
            type="button"
            aria-label={`${r.pinned ? 'Unpin' : 'Pin'} ${r.label}`}
            onClick={() => togglePin(props.harnessId!, r.id)}
            className="shrink-0 px-2 py-1.5 text-ink-dim hover:text-ink"
          >
            <Star className={cn('size-3.5', r.pinned && 'fill-current text-em')} />
          </button>
        )}
      </div>
    )
  }

  const defaultHi = !view.searching && highlight === 0 && visibleIds[0] === ''

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        if (o && props.disabled) return
        setOpen(o)
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          disabled={props.disabled}
          title={`Model: ${currentLabel}`}
          aria-label={`model: ${currentLabel}`}
          className={cn(
            'relative h-8 rounded-full px-2.5 font-normal',
            "after:absolute after:-inset-y-2 after:content-['']",
            props.className,
          )}
        >
          <Cpu className="size-3.5" />
          <span className="hidden max-w-40 truncate sm:inline">{currentLabel}</span>
          <ChevronDown className="size-3.5 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-0">
        <PopoverHeader className="border-b border-line px-4 py-3">
          <PopoverTitle>Model for next turn</PopoverTitle>
          <div className="relative mt-2">
            <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-ink-dim" />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onSearchKey}
              placeholder="search models…"
              className="w-full rounded-md border border-line bg-panel py-1.5 pl-7 pr-7 text-sm text-ink outline-none focus:border-em"
            />
            {query !== '' && (
              <button
                type="button"
                aria-label="clear search"
                onClick={() => setQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-dim hover:text-ink"
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>
        </PopoverHeader>
        <div ref={listRef} className="max-h-80 overflow-y-auto p-1.5">
          {view.searching ? (
            <>
              {view.matches.map((r) => modelRow(r))}
              <div className="px-2.5 py-1.5 text-[11px] text-ink-dim">
                {view.matches.length} of {props.options.length} models
              </div>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => pick('')}
                data-hi={defaultHi || undefined}
                className={cn(
                  'flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm',
                  defaultHi ? 'bg-panel' : '',
                  view.defaultRow.active ? 'text-ink' : 'text-ink-dim hover:text-ink',
                )}
              >
                <span className="min-w-0 flex-1 truncate">{view.defaultRow.label}</span>
                {view.defaultRow.active && <Check className="size-3.5 shrink-0 text-em" />}
              </button>
              {zone('★ Pinned', view.pinned)}
              {zone('◷ Recent', view.recent)}
              {(view.allInline.length > 0 || view.allRest.length > 0) && (
                <div>
                  <div className="px-2.5 py-1 text-[10px] font-medium uppercase tracking-wide text-ink-dim">
                    All
                  </div>
                  {view.allInline.map((r) => modelRow(r))}
                  {view.allRest.length > 0 && (
                    <>
                      {showAll && view.allRest.map((r) => modelRow(r))}
                      <button
                        type="button"
                        onClick={() => setShowAll((s) => !s)}
                        className="w-full px-2.5 py-1.5 text-center text-[11px] text-ink-dim hover:text-ink"
                      >
                        ── {view.allRest.length} more {showAll ? '▴' : '▾'} ──
                      </button>
                    </>
                  )}
                </div>
              )}
              {view.isEmpty && props.harnessId && (
                <div className="px-2.5 py-1.5 text-[11px] text-ink-dim">
                  ☆ Star a model to pin it here
                </div>
              )}
            </>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
