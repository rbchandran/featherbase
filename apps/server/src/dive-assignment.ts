// Per-user MotherDuck Dives. The sales-target page frames ONE Dive, chosen by
// DIVE_ID for every viewer; a `Dive Assignment` row gives one named user one
// more Dive (a store cockpit for a Store Manager, say) without touching that.
// The row is the grant: the server reads the caller's own rows on every call,
// mints a fresh embed session for the row's Dive and version with the row's
// starting state, and the browser receives only the session string. The
// creation token and service account are the sales-target ones (embedConfig).
//
// A Dive opened this way is NOT locked to the reader's data by Featherbase:
// whatever its starting state names, the Dive's own filters stay editable.
// Assign a whole-store Dive only to someone who may see the whole store.
import { Hono } from 'hono'
import { sql } from './db'
import { AppError } from './errors'
import { logAccess } from './audit'
import type { SessionUser } from './auth'
import { tableRelation } from './table-engine'
import { EMBED_ORIGIN, createEmbedSession, embedConfig, type SeedFetch } from './sales-target'

export const DIVE_ASSIGNMENT_TABLE = 'Dive Assignment'
export const DIVE_PATH = '/featherbase/dive'

/** A MotherDuck Dive id is a UUID; nothing else is sent upstream. */
const DIVE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const DIVE_ASSIGNMENT_DEF = {
  name: DIVE_ASSIGNMENT_TABLE,
  module: 'Sales Target',
  columns: [
    { column_name: 'employee', column_type: 'Reference', reference_table: 'User', reqd: true, in_list_view: true },
    { column_name: 'title', column_type: 'Data', reqd: true, in_list_view: true },
    { column_name: 'dive_id', column_type: 'Data', reqd: true, in_list_view: true },
    // Pinned, never "latest": a Dive edited upstream reaches readers only when this changes.
    { column_name: 'dive_version', column_type: 'Int', reqd: true, in_list_view: true },
    // The Dive's useDiveState keys to open on, e.g. {"ffloor": "Ground"}. A convenience, not a lock.
    { column_name: 'initial_state', column_type: 'JSON' },
  ],
}

export interface DiveAssignment {
  row_id: string
  title: string
  dive_id: string
  dive_version: number
  initial_state: Record<string, unknown>
}

async function ok(res: Response, what: string): Promise<Response> {
  if (!res.ok) throw new Error(`${what}: HTTP ${res.status} ${await res.text()}`)
  return res
}

export interface DiveAssignmentInput {
  employee: string
  title: string
  dive_id: string
  dive_version: number
  initial_state?: Record<string, unknown>
}

/**
 * Create the Table if it is missing, then give `employee` the Dive — through the
 * public API only, so the script (over HTTP) and the tests (`admin.fetch`) run the
 * same code. One row per (employee, Dive): a second run updates title, version and
 * starting state in place. Returns the row's id.
 */
export async function assignDive(f: SeedFetch, a: DiveAssignmentInput): Promise<string> {
  if (!DIVE_ID.test(a.dive_id)) throw new Error(`dive_id must be a MotherDuck Dive UUID, got ${JSON.stringify(a.dive_id)}`)
  if (!Number.isInteger(a.dive_version) || a.dive_version < 1)
    throw new Error(`dive_version must be a positive whole number, got ${JSON.stringify(a.dive_version)}`)
  const json = (body: unknown) => ({ method: 'POST', body: JSON.stringify(body) })
  const enc = encodeURIComponent
  const meta = await f(`/api/table/${enc(DIVE_ASSIGNMENT_TABLE)}:meta`)
  if (meta.status === 404) await ok(await f('/api/table_def', json(DIVE_ASSIGNMENT_DEF)), 'create table')
  else await ok(meta, 'read table meta')

  await ok(await f(`/api/table/User/${enc(a.employee)}`), `user ${a.employee}`)
  const filters = enc(JSON.stringify([['employee', '=', a.employee], ['dive_id', '=', a.dive_id]]))
  const list = (await (await ok(
    await f(`/api/table/${enc(DIVE_ASSIGNMENT_TABLE)}?filters=${filters}&fields=${enc('["row_id","updated_at"]')}`),
    'list dive assignments',
  )).json()) as { data: { row_id: string; updated_at: string }[] }
  const row = {
    employee: a.employee,
    title: a.title,
    dive_id: a.dive_id,
    dive_version: a.dive_version,
    initial_state: a.initial_state ?? null,
  }
  const existing = list.data[0]
  const saved = (await (await ok(
    await f('/api/save_row', json({
      table: DIVE_ASSIGNMENT_TABLE,
      row: existing ? { ...row, row_id: existing.row_id, updated_at: existing.updated_at } : row,
    })),
    `assign ${a.dive_id} to ${a.employee}`,
  )).json()) as { row_id: string }
  return String(saved.row_id)
}

async function tableExists(): Promise<boolean> {
  const [row] = await sql`select 1 from table_def where name = ${DIVE_ASSIGNMENT_TABLE}`
  return Boolean(row)
}

/**
 * The caller's Dives, read on every call. An instance without the Table has none.
 * A row whose Dive id or version is malformed is skipped and logged, never sent upstream.
 */
export async function divesFor(user: string): Promise<DiveAssignment[]> {
  if (!(await tableExists())) return []
  const rows = await sql`
    select row_id, title, dive_id, dive_version, initial_state
    from ${sql(await tableRelation(DIVE_ASSIGNMENT_TABLE))}
    where employee = ${user}
    order by title, row_id`
  const out: DiveAssignment[] = []
  for (const r of rows) {
    const version = Number(r.dive_version)
    const id = String(r.dive_id ?? '').trim()
    if (!DIVE_ID.test(id) || !Number.isInteger(version) || version < 1) {
      console.warn(`dive-assignment: ${user}: skipping ${r.row_id}: dive ${JSON.stringify(id)} version ${JSON.stringify(r.dive_version)}`)
      continue
    }
    const state = typeof r.initial_state === 'string' ? safeParse(r.initial_state) : r.initial_state
    out.push({
      row_id: String(r.row_id),
      title: String(r.title ?? id),
      dive_id: id,
      dive_version: version,
      initial_state: state && typeof state === 'object' && !Array.isArray(state) ? (state as Record<string, unknown>) : {},
    })
  }
  return out
}

function safeParse(v: string): unknown {
  try {
    return JSON.parse(v)
  } catch {
    return null
  }
}

/** Where a signed-in user with no other landing goes: their first Dive, if any. */
export async function diveLandingFor(user: string): Promise<string | undefined> {
  const [first] = await divesFor(user)
  return first ? `${DIVE_PATH}/${encodeURIComponent(first.row_id)}` : undefined
}

// Mounted under /api/dives, behind the session middleware in index.ts.
export const diveRoutes = new Hono<{ Variables: { user: SessionUser } }>()

// The caller's Dives — titles and ids only; never another user's rows.
diveRoutes.get('/mine', async (c) => {
  const user = c.get('user')
  const dives = await divesFor(user.row_id)
  return c.json({
    username: user.row_id,
    display_name: user.full_name ?? user.row_id,
    dives: dives.map((d) => ({ name: d.row_id, title: d.title })),
    embed_origin: EMBED_ORIGIN,
  })
})

// A fresh embed session for one of the caller's own Dives. Someone else's row,
// or no row, is the same 404: the answer must not reveal who has which Dive.
diveRoutes.post('/:name/embed_session', async (c) => {
  const user = c.get('user')
  const name = c.req.param('name')
  const dive = (await divesFor(user.row_id)).find((d) => d.row_id === name)
  if (!dive) throw new AppError('NotFoundError', `No Dive ${name} is assigned to you`)
  const r = await createEmbedSession(dive.initial_state, {
    ...embedConfig(),
    diveId: dive.dive_id,
    version: dive.dive_version,
  })
  if (!r.ok && r.kind === 'not_configured') return c.json({ not_configured: true, reason: r.error })
  if (!r.ok) return c.json({ error: { type: 'EmbedSessionError', message: r.error, upstream_status: r.status } }, 502)
  await logAccess(user.row_id, 'view_report', { table: DIVE_ASSIGNMENT_TABLE, row_id: dive.row_id, method: 'embed' })
  return c.json({ session: r.session, title: dive.title })
})
