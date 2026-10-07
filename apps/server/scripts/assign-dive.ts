/* Give one user one MotherDuck Dive, over the HTTP API of a running server,
 * exactly as an administrator would through the Admin: creates the
 * `Dive Assignment` Table if it is missing, then the row (or updates the
 * existing row for that user and Dive in place).
 *
 *   pnpm --filter server assign:dive -- --user RR-10104 \
 *     --dive 89449583-1c0d-467a-a50c-b3e5931ec132 --version 120 \
 *     --title "ATK Store TL Cockpit" [--state '{"ffloor":"Ground"}']
 *
 * SERVER_URL, ADMIN_USER and ADMIN_PASSWORD name the server and the admin
 * (defaults: http://localhost:8000, Administrator, admin). The user must
 * already exist. The Dive must be one the deployment's SERVICE_ACCOUNT can
 * open, including every share it attaches.
 */
import { parseArgs } from 'node:util'
import { assignDive } from '../src/dive-assignment'

const BASE = process.env.SERVER_URL ?? 'http://localhost:8000'
const ADMIN = process.env.ADMIN_USER ?? 'Administrator'
const ADMIN_PWD = process.env.ADMIN_PASSWORD ?? 'admin'

async function main() {
  // `pnpm assign:dive -- --user …` forwards the bare `--` too; it is not an argument.
  const { values } = parseArgs({
    args: process.argv.slice(2).filter((a) => a !== '--'),
    options: {
      user: { type: 'string' },
      dive: { type: 'string' },
      version: { type: 'string' },
      title: { type: 'string' },
      state: { type: 'string' },
    },
  })
  if (!values.user || !values.dive || !values.version || !values.title)
    throw new Error('usage: assign:dive -- --user <id> --dive <uuid> --version <n> --title <text> [--state <json>]')
  const state = values.state ? (JSON.parse(values.state) as unknown) : undefined
  if (state !== undefined && (typeof state !== 'object' || state === null || Array.isArray(state)))
    throw new Error('--state must be a JSON object')

  const login = await fetch(`${BASE}/api/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ usr: ADMIN, pwd: ADMIN_PWD }),
  })
  if (!login.ok) throw new Error(`admin login: HTTP ${login.status}`)
  const { token } = (await login.json()) as { token: string }
  const f = (path: string, init: RequestInit = {}) =>
    fetch(`${BASE}${path}`, {
      ...init,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
    })

  const row = await assignDive(f, {
    employee: values.user,
    title: values.title,
    dive_id: values.dive,
    dive_version: Number(values.version),
    initial_state: state as Record<string, unknown> | undefined,
  })
  console.log(`${BASE}: ${values.user} has Dive ${values.dive} v${values.version} as "${values.title}" (row ${row}); opens at /featherbase/dive/${encodeURIComponent(row)}`)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
