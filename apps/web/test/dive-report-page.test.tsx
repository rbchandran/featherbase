// A Dive assigned to one user (Dive Assignment): the page frames that user's own Dive,
// says plainly when a Dive is not theirs, and the sales-target page links to it.
// Server in-process; MotherDuck stubbed.
import { afterEach, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { _setEmbedFetch, seedSalesTarget } from 'server/src/sales-target'
import { _setSourceReader } from 'server/src/datasets/sales-target-mtd'
import { assignDive } from 'server/src/dive-assignment'
import { test, expect, renderApp } from './pg-test'

const COCKPIT = '89449583-1c0d-467a-a50c-b3e5931ec132'
const saved = { ...process.env }
beforeEach(() => {
  process.env.SALES_TARGET_TODAY = '2026-09-17'
  process.env.MOTHERDUCK_TOKEN = 'page-test-token'
  process.env.SERVICE_ACCOUNT = 'svc'
  process.env.SALES_TARGET_SHARED_ENV = '/nonexistent/sales-target.env'
  _setSourceReader(async () => [])
  _setEmbedFetch(async () => Response.json({ session: 'stub-session' }))
})
afterEach(() => {
  _setEmbedFetch(null)
  _setSourceReader(null)
  for (const k of ['SALES_TARGET_TODAY', 'MOTHERDUCK_TOKEN', 'SERVICE_ACCOUNT', 'SALES_TARGET_SHARED_ENV'])
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
})

type Admin = { fetch: (path: string, init?: RequestInit) => Promise<Response> }
type Api = Admin

async function setup(admin: Admin, api: Api) {
  await seedSalesTarget((path, init) => admin.fetch(path, init), { test_employee_1: 'pw-1', test_employee_2: 'pw-2', test_employee_3: 'pw-3', test_employee_4: 'pw-4' }, [
    { username: 'test_employee_1', display_name: 'Employee 1', plant_code: '1501', store_label: 'ATK', material_groups: ['010101001'] },
  ])
  const name = await assignDive((path, init) => admin.fetch(path, init), {
    employee: 'test_employee_1', title: 'ATK Store TL Cockpit', dive_id: COCKPIT, dive_version: 120,
  })
  const login = async (usr: string, pwd: string) => {
    const res = await api.fetch('/api/login', { method: 'POST', body: JSON.stringify({ usr, pwd }) })
    return ((await res.json()) as { token: string }).token
  }
  return { name, login }
}

test("the user's own Dive is framed from the embed origin with its fresh session", async ({ admin, api }) => {
  const { name, login } = await setup(admin, api)
  const token = await login('test_employee_1', 'pw-1')
  await renderApp(`/featherbase/dive/${name}`, { token, user: 'test_employee_1' } as never)
  const frame = await screen.findByTestId('dive-frame')
  expect(frame).toHaveAttribute('src', 'https://embed-motherduck.com/sandbox/#session=stub-session')
  expect(frame).toHaveAttribute('sandbox', 'allow-scripts allow-same-origin')
  expect(screen.getByTestId('dive-identity')).toHaveTextContent('ATK Store TL Cockpit')
})

test('a Dive that is not theirs says so, and is never framed', async ({ admin, api }) => {
  const { name, login } = await setup(admin, api)
  const token = await login('test_employee_2', 'pw-2')
  await renderApp(`/featherbase/dive/${name}`, { token, user: 'test_employee_2' } as never)
  await waitFor(() => expect(screen.getByTestId('dive-state')).toHaveAttribute('data-state', 'not-assigned'))
  expect(screen.queryByTestId('dive-frame')).not.toBeInTheDocument()
})

test('the sales-target page links to the Dives assigned to the reader', async ({ admin, api }) => {
  const { name, login } = await setup(admin, api)
  const token = await login('test_employee_1', 'pw-1')
  await renderApp('/featherbase/sales-target', { token, user: 'test_employee_1' } as never)
  const link = await screen.findByTestId('dive-link')
  expect(link).toHaveTextContent('ATK Store TL Cockpit')
  expect(link).toHaveAttribute('href', `/featherbase/dive/${name}`)
})
