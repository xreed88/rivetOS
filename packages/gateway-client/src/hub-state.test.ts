import { createServer, type Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { HubState, HubStateResponse } from '@rivetos/types'
import { GatewayError } from './http.js'
import { RivetGateway } from './client.js'

/** Stub of den's compare-and-set route: one document, version-checked PUTs. */
let doc: HubStateResponse = {
  version: 0,
  state: {
    projects: [],
    membership: {},
    names: {},
    archived: [],
    pinned: [],
    hidden: [],
    modes: {},
  },
}
let server: Server
let gw: RivetGateway

beforeAll(async () => {
  server = createServer((req, res) => {
    const send = (code: number, body: unknown): void => {
      res.writeHead(code, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(body))
    }
    if (req.url !== '/api/hub/state') return send(404, { error: 'not found' })
    if (req.method === 'GET') return send(200, doc)
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
        baseVersion: number
        state: HubState
      }
      if (body.state.projects.length > 1) return send(400, { error: 'too many projects' })
      if (body.baseVersion !== doc.version) return send(409, doc)
      doc = { version: doc.version + 1, state: body.state }
      send(200, doc)
    })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const addr = server.address()
  if (addr === null || typeof addr === 'string') throw new Error('no address')
  gw = new RivetGateway({ baseUrl: `http://127.0.0.1:${String(addr.port)}` })
})

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()))
})

describe('hub state client', () => {
  const next: HubState = {
    projects: [{ id: 'p1', name: 'General', order: 0, createdAt: 0 }],
    membership: {},
    names: { 'arctic::claude-code:abc': 'Renamed' },
    archived: [],
    pinned: [],
    hidden: [],
    modes: {},
  }

  it('reads, then writes against the version it read', async () => {
    const first = await gw.hubState()
    expect(first.version).toBe(0)
    const put = await gw.putHubState(first.version, next)
    expect(put).toEqual({ ok: true, version: 1, state: next })
  })

  it('resolves a stale write with the current document instead of throwing', async () => {
    const put = await gw.putHubState(0, { ...next, names: {} })
    expect(put).toEqual({ ok: false, version: 1, state: next })
  })

  it('throws GatewayError for any other failure', async () => {
    const tooBig = { ...next, projects: [...next.projects, { ...next.projects[0], id: 'p2' }] }
    await expect(gw.putHubState(1, tooBig)).rejects.toBeInstanceOf(GatewayError)
  })
})
