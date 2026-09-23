import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

const KEY = 'rivethub.modelPrefs'

export const RECENT_CAP = 5
export const NO_IDS: readonly string[] = Object.freeze([])

interface ModelPrefsState {
  pinned: Record<string, string[]>
  recent: Record<string, string[]>
  togglePin: (harnessId: string, modelId: string) => void
  recordRecent: (harnessId: string, modelId: string) => void
}

export function computeToggle(list: string[], id: string): string[] {
  const i = list.indexOf(id)
  if (i >= 0) return list.filter((_, j) => j !== i)
  return [...list, id]
}

export function computeRecent(list: string[], id: string, cap = RECENT_CAP): string[] {
  return [id, ...list.filter((x) => x !== id)].slice(0, cap)
}

function prune(
  map: Record<string, string[]>,
  harnessId: string,
  next: string[],
): Record<string, string[]> {
  if (next.length === 0) {
    const { [harnessId]: _removed, ...rest } = map
    void _removed
    return rest
  }
  return { ...map, [harnessId]: next }
}

export const useModelPrefs = create<ModelPrefsState>()(
  persist(
    (set) => ({
      pinned: {},
      recent: {},
      togglePin: (harnessId, modelId) =>
        set((s) => {
          const next = computeToggle(s.pinned[harnessId] ?? [], modelId)
          return { pinned: prune(s.pinned, harnessId, next) }
        }),
      recordRecent: (harnessId, modelId) => {
        if (modelId === '') return
        set((s) => ({
          recent: {
            ...s.recent,
            [harnessId]: computeRecent(s.recent[harnessId] ?? [], modelId),
          },
        }))
      },
    }),
    {
      name: KEY,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ pinned: s.pinned, recent: s.recent }),
    },
  ),
)
