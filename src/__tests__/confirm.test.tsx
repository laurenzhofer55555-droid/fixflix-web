import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import App from '../App'
import i18n from '../i18n'

const TOKEN = 'ab'.repeat(32)

type Reply = { ok: boolean; status: number; json: () => Promise<unknown> }
const ok = (body: unknown): Reply => ({ ok: true, status: 200, json: async () => body })

let confirmReply: Reply
let confirmCalls: Record<string, unknown>[]

beforeEach(async () => {
  await i18n.changeLanguage('de')
  confirmReply = ok({ status: 'confirmed' })
  confirmCalls = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, options: { body: string }) => {
      if (url.endsWith('/rpc/confirm_lead')) {
        confirmCalls.push(JSON.parse(options.body))
        return confirmReply
      }
      return ok(null)
    }),
  )
  vi.stubEnv('VITE_SUPABASE_URL', 'https://demo.supabase.co')
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'sb_publishable_test')
})

afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  window.history.replaceState(null, '', '/')
})

function openLink(hash: string) {
  window.history.replaceState(null, '', `/bestaetigen${hash}`)
  render(
    <MemoryRouter initialEntries={['/bestaetigen']}>
      <App />
    </MemoryRouter>,
  )
}

describe('confirmation link', () => {
  it('confirms only after a click, so mail scanners opening the link change nothing', async () => {
    const user = userEvent.setup()
    openLink(`#${TOKEN}`)

    expect(screen.getByRole('heading', { name: 'E-Mail-Adresse bestätigen' })).toBeInTheDocument()
    expect(confirmCalls).toHaveLength(0)

    await user.click(screen.getByRole('button', { name: 'Jetzt bestätigen' }))

    expect(confirmCalls).toEqual([{ p_token: TOKEN }])
    expect(await screen.findByRole('heading', { name: 'Du bist auf der Liste!' })).toBeInTheDocument()
  })

  it('wipes the token from the address bar', () => {
    openLink(`#${TOKEN}`)
    expect(window.location.hash).toBe('')
    expect(window.location.pathname).toBe('/bestaetigen')
  })

  it('reports an expired link', async () => {
    confirmReply = ok({ status: 'expired' })
    const user = userEvent.setup()
    openLink(`#${TOKEN}`)
    await user.click(screen.getByRole('button', { name: 'Jetzt bestätigen' }))

    expect(await screen.findByRole('heading', { name: 'Link abgelaufen' })).toBeInTheDocument()
  })

  it('says so when the address was confirmed before', async () => {
    confirmReply = ok({ status: 'already_confirmed' })
    const user = userEvent.setup()
    openLink(`#${TOKEN}`)
    await user.click(screen.getByRole('button', { name: 'Jetzt bestätigen' }))

    expect(await screen.findByRole('heading', { name: 'Schon erledigt' })).toBeInTheDocument()
  })

  it.each(['', '#kaputt', `#${TOKEN}<script>`])('rejects a malformed link (%s) without asking the server', (hash) => {
    openLink(hash)
    expect(screen.getByRole('heading', { name: 'Link ungültig' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Jetzt bestätigen' })).not.toBeInTheDocument()
    expect(confirmCalls).toHaveLength(0)
  })

  it('explains a rate limit and lets the visitor try again', async () => {
    confirmReply = { ok: false, status: 429, json: async () => ({ message: 'rate_limited' }) }
    const user = userEvent.setup()
    openLink(`#${TOKEN}`)
    await user.click(screen.getByRole('button', { name: 'Jetzt bestätigen' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/zu viele Anmeldungen/i)
    expect(screen.getByRole('button', { name: 'Jetzt bestätigen' })).toBeEnabled()
  })
})

describe('privacy policy', () => {
  it('has no mail section while confirmation mails are off', () => {
    render(
      <MemoryRouter initialEntries={['/datenschutz']}>
        <App />
      </MemoryRouter>,
    )
    expect(screen.queryByRole('heading', { name: /Bestätigungsmail/ })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /^9\. / })).toBeInTheDocument()
  })
})
