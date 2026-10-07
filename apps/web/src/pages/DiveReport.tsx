import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { api, clearSession, getSessionUser, getToken } from '../lib/api'
import { Logo } from '../components/Logo'

// A Dive assigned to this one user (Dive Assignment). Like the sales-target
// page, it holds no report logic: the server checks the row is the caller's,
// mints the embed session, and MotherDuck renders the Dive in a sandboxed
// iframe. The page owns the identity chrome, the switch between the user's
// own Dives, honest empty and error states, and sign-out.

interface Mine {
  username: string
  display_name: string
  dives: { name: string; title: string }[]
  embed_origin: string
}

type Embed =
  | { kind: 'loading' }
  | { kind: 'frame'; src: string }
  | { kind: 'not-assigned' }
  | { kind: 'not-configured' }
  | { kind: 'error'; message: string }

// Every opening bumps this; a response for an earlier opening is dropped.
let openingSeq = 0

export function DiveReportPage({ name }: { name: string }) {
  const navigate = useNavigate()
  const user = getSessionUser()
  const [mine, setMine] = useState<Mine | null>(null)
  const [embed, setEmbed] = useState<Embed>({ kind: 'loading' })
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    const seq = ++openingSeq
    const controller = new AbortController()
    abortRef.current = controller
    const current = () => seq === openingSeq && !controller.signal.aborted
    setEmbed({ kind: 'loading' })
    ;(async () => {
      try {
        const identity = await api.get<Mine>('/api/dives/mine')
        if (!current()) return
        setMine(identity)
        if (!identity.dives.some((d) => d.name === name)) {
          setEmbed({ kind: 'not-assigned' })
          return
        }
        const res = await fetch(`/api/dives/${encodeURIComponent(name)}/embed_session`, {
          method: 'POST',
          headers: { authorization: `Bearer ${getToken() ?? ''}` },
          signal: controller.signal,
        })
        const body = (await res.json().catch(() => ({}))) as {
          session?: string
          not_configured?: boolean
          error?: { message?: string }
        }
        if (!current()) return
        if (res.status === 401) {
          clearSession()
          window.location.href = '/featherbase/login'
          return
        }
        if (res.status === 404) setEmbed({ kind: 'not-assigned' })
        else if (body.not_configured) setEmbed({ kind: 'not-configured' })
        else if (res.ok && typeof body.session === 'string')
          setEmbed({ kind: 'frame', src: `${identity.embed_origin}/sandbox/#session=${encodeURIComponent(body.session)}` })
        else setEmbed({ kind: 'error', message: body.error?.message ?? `HTTP ${res.status}` })
      } catch (err) {
        if (!current()) return
        setEmbed({ kind: 'error', message: err instanceof Error ? err.message : 'network error' })
      }
    })()
    return () => controller.abort()
  }, [user?.row_id, name])

  async function logout() {
    openingSeq++
    abortRef.current?.abort()
    await api.post('/api/logout', {}).catch(() => {})
    clearSession()
    await navigate({ to: '/featherbase/login' })
  }

  const title = mine?.dives.find((d) => d.name === name)?.title

  return (
    <div className="flex min-h-screen flex-col bg-[var(--color-canvas)]">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2">
        <div className="flex items-center gap-3">
          <Logo className="h-7 w-7 rounded-md" />
          <div>
            <div className="text-sm font-semibold text-[var(--color-ink)]" data-testid="dive-identity">
              {mine ? `${mine.display_name} · ${title ?? 'Report'}` : 'Opening your report…'}
            </div>
            <p className="text-xs text-[var(--color-ink-muted)]">{mine ? `Signed in as ${mine.username}` : ''}</p>
          </div>
        </div>
        <nav className="flex flex-wrap items-center gap-2" aria-label="Your reports">
          {(mine?.dives ?? []).filter((d) => d.name !== name).map((d) => (
            <Link key={d.name} to="/featherbase/dive/$name" params={{ name: d.name }} className="fc-btn" data-testid="dive-link">
              {d.title}
            </Link>
          ))}
          <button type="button" className="fc-btn" data-testid="logout" onClick={() => void logout()}>
            Log out
          </button>
        </nav>
      </header>
      <main className="flex flex-1 flex-col p-2">
        {embed.kind === 'frame' ? (
          <iframe
            data-testid="dive-frame"
            title={title ?? 'Report'}
            sandbox="allow-scripts allow-same-origin"
            src={embed.src}
            className="min-h-[80vh] w-full flex-1 rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)]"
          />
        ) : (
          <div className="fc-card mx-auto mt-6 max-w-xl p-5 text-sm" data-testid="dive-state" data-state={embed.kind}>
            {embed.kind === 'loading' && <p className="text-[var(--color-ink-muted)]">Opening your report…</p>}
            {embed.kind === 'not-assigned' && (
              <>
                <p className="font-medium text-[var(--color-ink)]">This report is not assigned to you</p>
                <p className="mt-1 text-[var(--color-ink-muted)]">Ask your administrator to assign it.</p>
              </>
            )}
            {embed.kind === 'not-configured' && (
              <p className="text-[var(--color-ink-muted)]">Live MotherDuck reports are not configured on this deployment.</p>
            )}
            {embed.kind === 'error' && (
              <>
                <p className="font-medium text-[var(--color-danger)]">Report unavailable</p>
                <p className="mt-1 text-[var(--color-ink-muted)]">
                  The report session could not be created ({embed.message}). This is not a sales figure.
                </p>
              </>
            )}
          </div>
        )}
      </main>
    </div>
  )
}
