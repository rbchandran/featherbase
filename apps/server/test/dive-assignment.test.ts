// Per-user Dives (src/dive-assignment.ts). Every test builds the Table, the users
// and the rows inside its own sandbox transaction through the public API — the
// same assignDive() the script runs over HTTP. The upstream MotherDuck call is
// injected: no network, and the stub records exactly what would have been sent.
import { afterEach, describe, expect } from 'vitest'
import { test } from './pg-test'
import type { TestClient } from 'feather-testing-postgres'
import { _setEmbedFetch } from '../src/sales-target'
import { DIVE_ASSIGNMENT_TABLE, assignDive } from '../src/dive-assignment'

const COCKPIT = '89449583-1c0d-467a-a50c-b3e5931ec132'
const OTHER = '9022f10f-be83-4fba-a729-5399c18d150e'
const SENTINEL_TOKEN = 'sandbox-creation-token-never-served'

const saved = {
  token: process.env.MOTHERDUCK_TOKEN,
  account: process.env.SERVICE_ACCOUNT,
}
afterEach(() => {
  _setEmbedFetch(null)
  for (const [k, v] of [['MOTHERDUCK_TOKEN', saved.token], ['SERVICE_ACCOUNT', saved.account]] as const) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
})

interface Recorded {
  url: string
  body: { username: string; version: number; initial_state: unknown }
}
function stubUpstream(answer: { status: number; body: unknown } = { status: 200, body: { session: 'stub-session' } }) {
  const calls: Recorded[] = []
  _setEmbedFetch(async (input, init) => {
    calls.push({ url: String(input), body: JSON.parse(String(init?.body)) as Recorded['body'] })
    return new Response(JSON.stringify(answer.body), { status: answer.status, headers: { 'content-type': 'application/json' } })
  })
  return calls
}

async function makeUser(admin: TestClient, row_id: string) {
  const json = (body: unknown) => ({ method: 'POST', body: JSON.stringify(body) })
  const res = await admin.fetch('/api/save_row', json({
    table: 'User',
    row: { row_id, email: `${row_id.toLowerCase()}@example.invalid`, full_name: row_id, enabled: true },
  }))
  expect(res.status).toBe(201)
  expect((await admin.fetch('/api/set_password', json({ user: row_id, password: `pw-${row_id}` }))).ok).toBe(true)
}

async function loginAs(api: TestClient, usr: string) {
  const res = await api.fetch('/api/login', { method: 'POST', body: JSON.stringify({ usr, pwd: `pw-${usr}` }) })
  const body = (await res.json()) as { token?: string; landing?: string }
  expect(res.status).toBe(200)
  return { landing: body.landing, headers: { authorization: `Bearer ${body.token ?? ''}` } }
}

const f = (admin: TestClient) => (path: string, init?: RequestInit) => admin.fetch(path, init)

async function setup(admin: TestClient) {
  process.env.MOTHERDUCK_TOKEN = SENTINEL_TOKEN
  process.env.SERVICE_ACCOUNT = 'motherduck_dive_service_account'
  await makeUser(admin, 'RR-10104')
  await makeUser(admin, 'RR-20000')
  const name = await assignDive(f(admin), {
    employee: 'RR-10104',
    title: 'ATK Store TL Cockpit',
    dive_id: COCKPIT,
    dive_version: 120,
    initial_state: { ffloor: 'Ground' },
  })
  return { name }
}

describe('per-user Dives', () => {
  test('the assigned user lists their Dive and opens it: the pinned Dive, version and starting state go upstream', async ({ admin, api }) => {
    const { name } = await setup(admin)
    const calls = stubUpstream()
    const u = await loginAs(api, 'RR-10104')
    const mine = (await (await api.fetch('/api/dives/mine', { headers: u.headers })).json()) as {
      dives: { name: string; title: string }[]
      embed_origin: string
    }
    expect(mine.dives).toEqual([{ name, title: 'ATK Store TL Cockpit' }])
    expect(mine.embed_origin).toMatch(/^https:\/\//)

    const res = await api.fetch(`/api/dives/${encodeURIComponent(name)}/embed_session`, { method: 'POST', headers: u.headers })
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body).toEqual({ session: 'stub-session', title: 'ATK Store TL Cockpit' })
    expect(JSON.stringify(body)).not.toContain(SENTINEL_TOKEN)
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toMatch(new RegExp(`/v1/dives/${COCKPIT}/embed-session$`))
    expect(calls[0].body).toEqual({
      username: 'motherduck_dive_service_account',
      version: 120,
      initial_state: { ffloor: 'Ground' },
    })
  })

  test('a user with a Dive and no sales-target role lands on that Dive at sign-in', async ({ admin, api }) => {
    const { name } = await setup(admin)
    expect((await loginAs(api, 'RR-10104')).landing).toBe(`/featherbase/dive/${encodeURIComponent(name)}`)
    expect((await loginAs(api, 'RR-20000')).landing).toBeUndefined()
  })

  test("someone else's Dive is the same 404 as no Dive, and nothing goes upstream", async ({ admin, api }) => {
    const { name } = await setup(admin)
    const calls = stubUpstream()
    const other = await loginAs(api, 'RR-20000')
    const mine = (await (await api.fetch('/api/dives/mine', { headers: other.headers })).json()) as { dives: unknown[] }
    expect(mine.dives).toEqual([])
    expect((await api.fetch(`/api/dives/${encodeURIComponent(name)}/embed_session`, { method: 'POST', headers: other.headers })).status).toBe(404)
    expect((await api.fetch('/api/dives/no-such-row/embed_session', { method: 'POST', headers: other.headers })).status).toBe(404)
    expect(calls).toEqual([])
  })

  test('the routes require a session, and the Table is not readable by the assigned user', async ({ admin, api }) => {
    const { name } = await setup(admin)
    const calls = stubUpstream()
    expect((await api.fetch('/api/dives/mine')).status).toBe(401)
    expect((await api.fetch(`/api/dives/${encodeURIComponent(name)}/embed_session`, { method: 'POST' })).status).toBe(401)
    const u = await loginAs(api, 'RR-10104')
    expect((await api.fetch(`/api/table/${encodeURIComponent(DIVE_ASSIGNMENT_TABLE)}`, { headers: u.headers })).status).toBe(403)
    expect(calls).toEqual([])
  })

  test('assigning again updates the one row in place; a second Dive adds a row', async ({ admin, api }) => {
    const { name } = await setup(admin)
    const again = await assignDive(f(admin), { employee: 'RR-10104', title: 'ATK Cockpit', dive_id: COCKPIT, dive_version: 121 })
    expect(again).toBe(name)
    await assignDive(f(admin), { employee: 'RR-10104', title: 'Sales target', dive_id: OTHER, dive_version: 10 })
    const calls = stubUpstream()
    const u = await loginAs(api, 'RR-10104')
    const mine = (await (await api.fetch('/api/dives/mine', { headers: u.headers })).json()) as { dives: { name: string; title: string }[] }
    expect(mine.dives.map((d) => d.title)).toEqual(['ATK Cockpit', 'Sales target'])
    await api.fetch(`/api/dives/${encodeURIComponent(name)}/embed_session`, { method: 'POST', headers: u.headers })
    expect(calls[0].body.version).toBe(121)
    expect(calls[0].body.initial_state).toEqual({})
  })

  test('a malformed Dive id or version is refused before anything is written', async ({ admin }) => {
    await makeUser(admin, 'RR-10104')
    await expect(assignDive(f(admin), { employee: 'RR-10104', title: 't', dive_id: 'not-a-uuid', dive_version: 1 })).rejects.toThrow(/UUID/)
    await expect(assignDive(f(admin), { employee: 'RR-10104', title: 't', dive_id: COCKPIT, dive_version: 0 })).rejects.toThrow(/positive/)
    expect((await admin.fetch(`/api/table/${encodeURIComponent(DIVE_ASSIGNMENT_TABLE)}:meta`)).status).toBe(404)
  })

  test('without the service account configured the Dive answers not_configured, not an error', async ({ admin, api }) => {
    const { name } = await setup(admin)
    delete process.env.SERVICE_ACCOUNT
    const calls = stubUpstream()
    const u = await loginAs(api, 'RR-10104')
    const res = await api.fetch(`/api/dives/${encodeURIComponent(name)}/embed_session`, { method: 'POST', headers: u.headers })
    expect(res.status).toBe(200)
    expect(((await res.json()) as { not_configured?: boolean }).not_configured).toBe(true)
    expect(calls).toEqual([])
  })

  test('an upstream refusal is a 502 that names the upstream status', async ({ admin, api }) => {
    const { name } = await setup(admin)
    stubUpstream({ status: 403, body: { message: 'service account cannot read share silver_zakya' } })
    const u = await loginAs(api, 'RR-10104')
    const res = await api.fetch(`/api/dives/${encodeURIComponent(name)}/embed_session`, { method: 'POST', headers: u.headers })
    expect(res.status).toBe(502)
    const body = (await res.json()) as { error: { upstream_status: number; message: string } }
    expect(body.error.upstream_status).toBe(403)
    expect(body.error.message).toContain('silver_zakya')
  })
})
