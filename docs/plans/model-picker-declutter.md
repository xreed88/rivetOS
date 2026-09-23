# Plan: per-turn model picker declutter (client-side)

**Status:** ready to implement. Design is locked (see "Decisions"); no open blockers.
Revised 2026-09-23 after review — see "Revision log" at the end.
**Before starting:** this branch holds only the plan and sits on upstream `main`; rebase if
`main` has moved. Step 4 edits `pages/chat.tsx`, as does the separate `fix/chat-waiting-indicator`
PR. If that PR has landed upstream, the rebase picks it up. If it hasn't, expect a small
conflict in `chat.tsx` near `<Composer>` later.

**Picking this up cold (any machine, any agent):** this file is the whole brief — no chat
history or memory needed.
```bash
git clone https://github.com/xreed88/rivetOS && cd rivetOS   # or: git fetch origin in an existing clone
git remote add upstream https://github.com/philbert440/rivetOS 2>/dev/null; git fetch upstream
git checkout docs/model-picker-plan
git rebase upstream/main          # see "Before starting" above
npm ci
cd apps/rivethub-web && npm test  # baseline should be green before you change anything
```
Then work Steps 1 → 4 in order, run "Verification", and commit per the author convention
below. Rename the branch to `feat/turn-model-picker` if you like; the plan commit can ride along.
**Scope:** `apps/rivethub-web` only. **No backend / no `model-sheets.ts` / no den-server changes.**
**Author convention for this repo:** commit as the fork owner **xreed88 `<xreed88@gmail.com>`**
(`git commit --author='xreed88 <xreed88@gmail.com>'`). This is a fork of
`philbert440/rivetOS`; the maintainer re-lands PRs upstream as "supersedes #N". Do **not**
add a `Co-Authored-By:` trailer or a "Generated with" line. (The repo `CLAUDE.md` names
`Rivet Philbot` — that is the maintainer's identity for upstream re-lands, not for this fork's
contributor commits.)

---

## Goal

The composer's **per-turn model `Select`** is a flat `[Default, ...allModels]` dropdown. For
big-catalog harnesses (opencode, codex) it's unusable; for small ones (claude) it's fine.
Replace it with a **sectioned, searchable popover** that surfaces a curated ~5–10 up top and
collapses the long tail. Pure UX declutter — the harness can still run any model; we only
curate the *view*. No popularity ranking (there's no data for it on a local FTS-only node).

## Decisions (locked — do not re-litigate)

1. **Client-side only.** Sheet stays full server-side; we filter what's shown. Chosen over an
   enforced server override.
2. **Default view = "curated + short tail":** Pinned ★, then Recent, then a short inline slice
   of "All", with the rest behind a "N more" expander. Search flattens all zones into ranked
   matches.
3. **Curation UI = inline ★ pin toggle per row.** No separate settings page. (A settings
   section may come later for bulk reorder — out of scope here.)
4. **"Popularity" = your own Recent picks** (local MRU), not a global signal.
5. **Prefs keyed by `harnessId`** (per provider), persisted to `localStorage`. A pinned id
   absent from the current node's sheet simply doesn't render — degrades cleanly, so no
   per-node vs global split is needed.
6. **Pinned wins over Recent:** a model that is both shows only under Pinned.
7. **The `''` "Session default (…)" row is first-class:** always at the top of the unsearched
   view, never subject to pin/collapse.
8. **Pin order = order pinned:** new pins append to the end of the Pinned zone.
9. **The current pick is never hidden:** if it would fall behind "N more", it is promoted to
   the end of the inline All slice.

---

## File inventory

| Action | Path | What |
| --- | --- | --- |
| **new** | `apps/rivethub-web/src/stores/model-prefs.ts` | zustand+persist store: pinned + recent per harness |
| **new** | `apps/rivethub-web/src/stores/model-prefs.test.ts` | store + pure-helper unit tests |
| **new** | `apps/rivethub-web/src/lib/turn-model-picker-view.ts` | **pure** view builder (zones/search) — the testable core |
| **new** | `apps/rivethub-web/src/lib/turn-model-picker-view.test.ts` | view-builder unit tests |
| **new** | `apps/rivethub-web/src/components/pickers/turn-model-picker.tsx` | thin popover that renders the view |
| **edit** | `apps/rivethub-web/src/components/composer.tsx` | swap the flat per-turn `Select` for `TurnModelPicker`; thread `harnessId` |
| **edit** | `apps/rivethub-web/src/pages/chat.tsx` | pass `harnessId={nativeHarnessId}` to `<Composer>`; record Recent on pick |

> **Testing reality (verified):** rivethub-web's `vitest.config.ts` globs **`src/**/*.test.ts`
> only** — no `.tsx` tests, **no jsdom, no `@testing-library`** in deps. All 92 existing tests
> are pure logic. So **do not** write an RTL `.test.tsx` (it won't be collected and would need
> new deps + a config change — out of scope). Instead put all decision logic in the pure
> `turn-model-picker-view.ts` module and test it in `.test.ts`; keep the `.tsx` a dumb renderer.

**Do not touch:** `services/den-server/**`, `packages/types/**`, `model-sheets.ts`, the
harness/effort pickers, `conversation-model-options.ts` (its output shape is the input here).

---

## Reference contracts (already in tree — build against these)

- `SelectOption` (`components/select.tsx`): `{ value: string; label: string; group?: string }`.
  The per-turn model list arrives as `SelectOption[]` where **`value` is the model id**.
- `conversationModelOptions(...)` (`lib/conversation-model-options.ts`) returns, among others:
  - `models: SelectOption[]` — the real provider models (already mapped from `HarnessModelOption`)
  - `efforts: SelectOption[]`
  - `effective: { model?; effort? }` — current pick
  - `defaultModelLabel: string` — label for the `''` row (e.g. `"Session default (Opus 5)"`)
- Current per-turn `Select` lives in `components/composer.tsx` (search for
  `props.turnOptions?.models.length` — the first `<Select>` with
  `label="Model for next turn"`). It builds options as
  `[{ value: '', label: defaultModelLabel }, ...turnOptions.models]`.
- `chat.tsx`: `nativeHarnessId` (a `HarnessId | undefined`) is in scope where `turnOptions`
  is computed (`const turnOptions = conversationModelOptions(nativeHarnessId, ...)`), and again
  where `<Composer>` is rendered with `onTurnPick`. **This is the key for model-prefs.**
- Persist pattern to copy: `stores/sidebar-prefs.ts` — zustand `persist` with
  `createJSONStorage(() => localStorage)`. Do **not** copy `chat-settings.ts`'s custom
  `PersistStorage`; that exists only to read a legacy on-disk format, which this new store
  doesn't have.
- Popover primitives: `components/ui/popover.tsx` (`Popover`, `PopoverTrigger`,
  `PopoverContent`, `PopoverHeader`, `PopoverTitle`). Trigger/`Button` styling: copy
  `components/pickers/model-picker.tsx` (the harness picker) — same visual language, `Cpu`
  icon, `h-8 rounded-full` ghost button, `Check` for active row. Icons from `lucide-react`
  (`Search`, `Star`, `Check`, `ChevronDown`, `X`).

---

## Step 1 — `stores/model-prefs.ts`

Zustand store, persisted to `localStorage` key `rivethub.modelPrefs` via
`createJSONStorage(() => localStorage)`, like `sidebar-prefs.ts`.

```ts
export const RECENT_CAP = 5
/** Shared empty list — selectors must return this, never a fresh `[]` (see below). */
export const NO_IDS: readonly string[] = Object.freeze([])

interface ModelPrefsState {
  /** harnessId -> pinned model ids, in pin order (new pins append) */
  pinned: Record<string, string[]>
  /** harnessId -> recent model ids, MRU-first, capped */
  recent: Record<string, string[]>
  togglePin: (harnessId: string, modelId: string) => void
  recordRecent: (harnessId: string, modelId: string) => void
}
```

State is plain data plus two actions. There are deliberately no getter functions such as
`pinnedFor()`: a component that calls a getter from the store doesn't re-render when pins
change. Components select the data directly:

```ts
const pinnedIds = useModelPrefs((s) => (harnessId && s.pinned[harnessId]) || NO_IDS)
```

**Always fall back to the shared `NO_IDS`.** A selector returning `?? []` makes a new array on
every render, and zustand v5 treats that as a change and loops forever.

Rules:
- `togglePin`: add/remove `modelId` in `pinned[harnessId]`; create the array if absent; prune
  empty arrays.
- `recordRecent`: unshift `modelId`, dedupe, slice to `RECENT_CAP`. **Ignore `''`** (the default
  row is not a "recent model").
- All array ops immutable (return new objects) so zustand subscribers re-render.

Export pure helpers so tests don't need the hook:
```ts
export function computeToggle(list: string[], id: string): string[]
export function computeRecent(list: string[], id: string, cap = RECENT_CAP): string[]
```

## Step 2a — `lib/turn-model-picker-view.ts` (pure, fully tested)

All zone/search logic lives here so it's testable without a DOM. The component (Step 2b) only
renders what this returns.

```ts
export interface PickerRow { id: string; label: string; pinned: boolean }
export interface PickerView {
  defaultRow: { label: string; active: boolean }   // the '' session-default row
  searching: boolean
  // when !searching:
  pinned: PickerRow[]
  recent: PickerRow[]         // excludes pinned, excludes ''
  allInline: PickerRow[]      // first TAIL_INLINE of the remainder
  allRest: PickerRow[]        // the rest (behind "N more")
  // when searching:
  matches: PickerRow[]        // flat, ranked (footer total is just options.length)
  isEmpty: boolean            // no pins AND no recents (drives the first-run hint)
}

export const TAIL_INLINE = 4

export function buildPickerView(input: {
  options: SelectOption[]      // value = model id; excludes the '' row
  value: string                // current pick ('' = default)
  defaultLabel: string
  pinnedIds: string[]
  recentIds: string[]
  query: string
}): PickerView
```

Rules to implement + test here:
- Map only ids that exist in `options` (drop unknown pinned/recent ids).
- Precedence: an id in `pinned` never appears in `recent` or `all`; an id in `recent` never in
  `all`. `''` is never in any zone.
- `allInline = remainder.slice(0, TAIL_INLINE)`, `allRest = remainder.slice(TAIL_INLINE)`.
- If the current pick (`value`) would land in `allRest`, move it to the end of `allInline`
  so the active row is always visible.
- Search (`query.trim() !== ''`): case-insensitive; rank prefix-of-label, then prefix-of-id,
  then substring; stable within a rank. `matches` spans the whole catalog (pins included).
  **This is the only definition of search ranking** — the component does not re-implement it.
- `isEmpty = pinned.length === 0 && recent.length === 0`.

## Step 2b — `components/pickers/turn-model-picker.tsx`

```ts
export function TurnModelPicker(props: {
  value: string                       // current model id, '' = session default
  options: SelectOption[]             // real models (value = id); NOT incl. the '' row
  defaultLabel: string                // turnOptions.defaultModelLabel, for the '' row
  onChange: (value: string) => void
  harnessId?: string                  // key for pins/recents; if undefined, no pin/recent zones
  disabled?: boolean
  className?: string
}): JSX.Element
```

Holds only React state (`open`, `query`, `showAll`, `highlight`) + store hooks (selected as in
Step 1, falling back to `NO_IDS`). Everything else comes from `buildPickerView(...)`; the
component contains **no zone, filter, or ranking logic** — it renders the view it's given.

Rendering (see mock at bottom):

1. **Trigger** — ghost `Button` like `model-picker.tsx`; label = current option's label, or
   `defaultLabel` when `value === ''`. `Cpu` + `ChevronDown`. Keep the old `Select`'s `title`
   tooltip (`Model: <label>`).
2. **Popover body** — `PopoverHeader` "Model for next turn" and a **search input** (`Search`
   icon, controlled `query`, `X` to clear) that is focused when the popover opens.
3. **Not searching** — default row, then zone headers ★ Pinned / ◷ Recent / All for the
   non-empty zones in the view, then a `── N more ▾ ──` toggle for `allRest` (`showAll`), then
   the first-run hint when `isEmpty`.
4. **Searching** — `matches` flat with no headers, and a `"{matches.length} of
   {options.length} models"` footer.
5. **`harnessId` undefined** — pass empty pins/recents and hide the stars. (Pins need a key.)

**Row markup:** each model row is a `div` holding **two sibling buttons** — the label button
(`onChange(id)` + close) and the ★/☆ star button (`togglePin(harnessId, id)`, popover stays
open, `aria-label={`${pinned ? 'Unpin' : 'Pin'} ${label}`}`). Don't put the star button
inside the row button; a button inside a button is invalid HTML, and browsers and screen
readers handle it unpredictably.

**Keyboard:**
- Focus stays in the search input.
- ↑/↓ move a highlight through the visible rows, including the default row, and skip the
  "N more" toggle.
- Enter selects the highlighted row; while searching, the highlight starts on the top match.
- Esc clears a non-empty query first, then closes the popover.
- Tab reaches the star buttons.

Accessibility otherwise mirrors `model-picker.tsx` (`aria-label` on the trigger).

## Step 3 — wire into `composer.tsx`

- Add `harnessId?: HarnessId` to the `Composer` props interface.
- Replace the first per-turn `<Select label="Model for next turn" …>` block with:
  ```tsx
  <TurnModelPicker
    value={props.turnOptions.effective.model ?? ''}
    options={props.turnOptions.models}
    defaultLabel={props.turnOptions.defaultModelLabel}
    harnessId={props.harnessId}
    onChange={(model) =>
      props.onTurnPick?.({ model: model || undefined, effort: props.turnOptions?.effective.effort })
    }
    className="max-w-[12rem] min-w-0 rounded-full"
  />
  ```
- **Leave the effort `<Select>` immediately after it unchanged.**
- Keep the `!!props.turnOptions?.models.length` guard around it (no picker when the sheet is empty).

## Step 4 — wire into `chat.tsx`

- Pass `harnessId={nativeHarnessId}` to `<Composer>`.
- In the existing `onTurnPick` handler (currently
  `setSetting(settingsKey, { turnPick: { harnessId: nativeHarnessId, ...pick } })`), also record
  the recent when a concrete model was chosen:
  ```ts
  onTurnPick={
    nativeHarnessId
      ? (pick) => {
          if (pick.model) useModelPrefs.getState().recordRecent(nativeHarnessId, pick.model)
          setSetting(settingsKey, { turnPick: { harnessId: nativeHarnessId, ...pick } })
        }
      : undefined
  }
  ```
  (Import the store; use `.getState()` to avoid adding a subscription in the parent.)

---

## Behavior / edge cases to honor (from the agreed mock)

- **Pinned excludes Recent excludes All** — a model appears in exactly one zone; Pinned wins,
  then Recent, then All.
- **Unknown pinned/recent ids** (pinned on another node, model since removed) are silently
  skipped, never rendered as dead rows.
- **Empty prefs (first run):** no Pinned/Recent zones; default row + short-tail All; show a
  one-line hint `"☆ Star a model to pin it here"`. Must work with zero stored prefs.
- **Small catalog (claude, 7–8):** "N more" reveals the last 2–3; never a scary jump.
- **Big catalog (opencode, 40+):** All collapses to `TAIL_INLINE`; the escape hatch is search.
- **Star toggle keeps the popover open**; row select closes it.
- **`''` default row** is always present and pinnable-exempt.

---

## Tests (all pure `.test.ts` — no DOM; matches repo convention)

**`turn-model-picker-view.test.ts`** — the bulk of the coverage lives here:
- Default zones built from pins+recents; a both-pinned-and-recent id lands only in `pinned`.
- Precedence: pinned ∉ recent ∉ all; `''` in no zone.
- `allInline`/`allRest` split at `TAIL_INLINE`; small catalog → `allRest` short; big catalog →
  `allRest` large.
- Unknown pinned/recent ids (not in `options`) are dropped.
- `isEmpty` true iff no pins and no recents.
- Search: ranks prefix-label > prefix-id > substring; `matches` spans whole catalog;
  empty query → `searching: false`.
- `defaultRow.active` true iff `value === ''`.
- A current pick that would fall into `allRest` is promoted to the end of `allInline`.

**`model-prefs.test.ts`** — store + exported pure helpers:
- `computeToggle` appends then removes (pin order preserved); `computeRecent`
  unshift/dedupe/cap at `RECENT_CAP`.
- `togglePin` creates/prunes the harness array; `recordRecent` ignores `''`.
- Two harnesses keep independent pins/recents.
- No persistence tests. The store uses zustand's standard `createJSONStorage`, and there's no
  custom storage code of ours to test.

**Component (`.tsx`)** is a thin renderer over the tested view — no test file (the repo has no
DOM test harness and this plan does not add one). If DOM coverage is later wanted, that's a
separate task: add `jsdom` + `@testing-library/react` + widen the vitest `include` to `.tsx`.
Reference the existing pure `components/*.test.ts` (e.g. `node-switcher.test.ts`) for the
style — they test extracted logic, not rendered React.

---

## Verification (run before committing)

```bash
# from repo root. nx project name is @rivetos/rivethub-web (verified).
cd apps/rivethub-web
npm test -- turn-model-picker-view model-prefs   # the new pure tests
npm test                                         # full app suite (all src/**/*.test.ts)
cd ../.. && npx nx typecheck @rivetos/rivethub-web
```
This change is app-local; no cross-package build needed. Note the vitest `include` is
`src/**/*.test.ts` — a `.test.tsx` would be silently skipped, so keep tests in `.test.ts`.

Manual smoke (optional, per `run` skill): open a conversation on a `turnOptions`-capable
harness, confirm the picker opens sectioned, pin/unpin persists across reload, search filters,
and the effort picker beside it is unchanged.

---

## Out of scope / deferred

- Server-side enforced model allow-list (the other fork of the original idea — not chosen).
- A dedicated settings page/section for bulk reorder.
- Reading the default model from `~/.claude/settings.json` (separate follow-up noted on the
  `claudeSheet` work).
- Any change to the harness/agent `ModelPicker` popover.

---

## Appendix — agreed mock (target UX)

```
① DEFAULT — claude-code (curated + short tail)      ② DEFAULT — opencode (big catalog)
┌─ Model for next turn ──────────────┐              ┌─ Model for next turn ──────────────┐
│ 🔍 search models…                  │              │ 🔍 search models…                  │
│ ★ Pinned                           │              │ ★ Pinned                           │
│   ● Opus 5                    ★     │              │   ● anthropic/claude-sonnet-5 ★    │
│     Sonnet 5                  ★     │              │     openai/gpt-5.2            ★    │
│ ◷ Recent                           │              │     google/gemini-3-pro       ★    │
│     Haiku 4.5                 ☆     │              │ ◷ Recent                           │
│   All                              │              │     deepseek/deepseek-v4-flash ☆   │
│     Fable 5.1                 ☆     │              │     zai/glm-5.3-flash          ☆   │
│     Fable 5.1 1M context      ☆     │              │   All                              │
│     Opus 5 1M context         ☆     │              │     anthropic/claude-haiku-5   ☆   │
│   ── 2 more ▾ ──                   │              │     mistral/mistral-large-3    ☆   │
└────────────────────────────────────┘              │   ── 37 more ▾ ──                  │
                                                     └────────────────────────────────────┘
③ SEARCHING ("son")                                 ⑤ FIRST RUN (no prefs)
┌─ Model for next turn ──────────────┐              ┌─ Model for next turn ──────────────┐
│ 🔍 son|                       ✕    │              │ 🔍 search models…                  │
│   ● anthropic/claude-sonnet-5 ★    │              │   Session default (Opus 5)    ✓    │
│     Sonnet 5                  ★     │              │   All                              │
│     Sonnet 5 1M context       ☆     │              │     Fable 5.1                 ☆    │
│   3 of 42 models                   │              │     Opus 5 · Sonnet 5 · Haiku ☆    │
└────────────────────────────────────┘              │   ── 3 more ▾ ──                   │
                                                     │   ☆ Star a model to pin it here    │
● = current pick   ✓ = default row                  └────────────────────────────────────┘
★ = pinned         ☆ = click to pin
```

---

## Revision log

**2026-09-23 — review pass (fixes + simplifications)**

Fixes:
- Search ranking was specified twice with different rules (Step 2a vs 2b). 2a is now the
  only definition; 2b just renders.
- Store getters (`pinnedFor`/`recentFor`/`isPinned`) removed. Getter calls don't make the
  component re-render when pins change. Components now select data directly and fall back to
  the shared `NO_IDS` constant; a fresh `[]` in a selector makes zustand v5 loop forever.
- Star toggle moved out of the row button (a button inside a button is invalid HTML). Rows
  are now a `div` holding two sibling buttons.
- Added keyboard spec (autofocus search, ↑/↓, Enter, Esc, Tab to stars).
- Current pick can no longer be hidden behind "N more" (Decision 9).
- Pin order decided: append (Decision 8).
- Added "rebase onto `main` first" — later commits touch `chat.tsx`.
- Kept the old `Select`'s `title` tooltip on the new trigger.

Simplifications:
- Persist via `createJSONStorage` (the `sidebar-prefs.ts` pattern), not `chat-settings.ts`'s
  custom storage, which only exists for a legacy format. The persistence tests are removed
  with it.
- Store state is just `pinned`, `recent`, `togglePin`, `recordRecent` (no nested `prefs`).
- Dropped `matchTotal` (always `options.length`).
