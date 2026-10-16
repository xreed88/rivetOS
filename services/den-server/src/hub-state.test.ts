import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { emptyHubState, type HubState, type UserContext } from '@rivetos/types'
import { createHubStateStore, hubStateScope } from './hub-state.js'

const dirs: string[] = []
afterEach(() => {
  dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true }))
})

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'hub-state-'))
  dirs.push(dir)
  return join(dir, 'hub-state')
}

const coco: UserContext = {
  userId: 'coco',
  deviceId: 'win-coco',
  db: { pgUrl: 'postgres://coco@db/coco' },
  isOwner: false,
}
const owner: UserContext = {
  userId: 'alex',
  deviceId: null,
  db: { pgUrl: 'postgres://owner@db/rivet_memory' },
  isOwner: true,
}

const STATE: HubState = {
  projects: [{ id: 'p1', name: 'General', order: 0, createdAt: 1 }],
  defaultProjectId: 'p1',
  membership: { 'arctic::claude-code:abc': 'p1' },
  names: { 'arctic::claude-code:abc': 'Hub state' },
  archived: [],
}

describe('hubStateScope', () => {
  it('maps tenancy-off and the owner to one scope, routed users to their own', () => {
    expect(hubStateScope(undefined)).toBe('owner')
    expect(hubStateScope(owner)).toBe('owner')
    expect(hubStateScope(coco)).toBe('user-coco')
  })
})

describe('hub state store', () => {
  it('serves an empty version-0 document before the first write', () => {
    const store = createHubStateStore(tempDir())
    expect(store.get('owner')).toEqual({ version: 0, state: emptyHubState() })
  })

  it('writes against the current version and persists across restarts', () => {
    const dir = tempDir()
    const store = createHubStateStore(dir)
    expect(store.put('owner', 0, STATE)).toEqual({ ok: true, version: 1, state: STATE })
    const reloaded = createHubStateStore(dir)
    expect(reloaded.get('owner')).toEqual({ version: 1, state: STATE })
    expect(statSync(join(dir, 'owner.json')).mode & 0o777).toBe(0o600)
  })

  it('refuses a stale baseVersion with the current document and keeps it intact', () => {
    const store = createHubStateStore(tempDir())
    store.put('owner', 0, STATE)
    const stale = store.put('owner', 0, { ...STATE, names: {} })
    expect(stale).toEqual({ ok: false, conflict: true, version: 1, state: STATE })
    // the losing device merges onto the returned document and retries
    const merged = store.put('owner', 1, { ...STATE, archived: ['arctic::codex:x'] })
    expect(merged).toMatchObject({ ok: true, version: 2 })
  })

  it('keeps scopes apart', () => {
    const dir = tempDir()
    const store = createHubStateStore(dir)
    store.put('user-coco', 0, STATE)
    expect(store.get('owner')).toEqual({ version: 0, state: emptyHubState() })
    expect(store.get('user-coco').version).toBe(1)
    expect(readdirSync(dir).sort()).toEqual(['user-coco.json'])
  })

  it('turns an unusual scope into a safe filename', () => {
    const dir = tempDir()
    const store = createHubStateStore(dir)
    store.put('user-../../etc', 0, STATE)
    expect(readdirSync(dir)).toHaveLength(1)
    expect(readdirSync(dir)[0]).toMatch(/^x-[0-9a-f]+\.json$/)
  })

  it('rejects a malformed body or baseVersion without writing', () => {
    const dir = tempDir()
    const store = createHubStateStore(dir)
    expect(store.put('owner', '0', STATE)).toMatchObject({ ok: false, conflict: false })
    expect(store.put('owner', -1, STATE)).toMatchObject({ ok: false, conflict: false })
    expect(store.put('owner', 0, 'nope')).toMatchObject({ ok: false, conflict: false })
    expect(existsSync(dir)).toBe(false)
  })

  it('writes temp + rename, and a failed write neither advances the version nor touches the file', () => {
    const dir = tempDir()
    const store = createHubStateStore(dir)
    store.put('owner', 0, STATE)
    expect(readdirSync(dir)).toEqual(['owner.json'])
    const before = readFileSync(join(dir, 'owner.json'), 'utf8')

    // a directory where the temp file goes makes the write fail
    mkdirSync(join(dir, `owner.json.${process.pid}.tmp`))
    expect(() => store.put('owner', 1, { ...STATE, names: {} })).toThrow()
    expect(store.get('owner').version).toBe(1)
    expect(readFileSync(join(dir, 'owner.json'), 'utf8')).toBe(before)
  })

  it('moves an unreadable file aside and starts fresh', () => {
    const dir = tempDir()
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'owner.json'), '{"version": 3, "state": ')
    const store = createHubStateStore(dir)
    expect(store.get('owner')).toEqual({ version: 0, state: emptyHubState() })
    expect(readdirSync(dir).some((f) => f.startsWith('owner.json.corrupt-'))).toBe(true)
  })
})
