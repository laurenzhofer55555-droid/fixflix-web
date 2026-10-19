import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import App from '../App'
import i18n from '../i18n'

// The real solver is covered in pow.test.ts; here it answers instantly.
vi.mock('../lib/pow', () => ({
  solve: vi.fn(async (challenge: { salt: string; challenge: string; signature: string }) => ({
    salt: challenge.salt,
    challenge: challenge.challenge,
    signature: challenge.signature,
    number: '42',
  })),
}))

const challenge = { salt: 'a'.repeat(24) + '.1900000000', challenge: 'c'.repeat(64), signature: 'd'.repeat(64), maxnumber: 1000 }
const HUMAN_PAUSE_MS = 10_000

type Reply = { ok: boolean; status: number; json: () => Promise<unknown> }
const ok = (body: unknown): Reply => ({ ok: true, status: 200, json: async () => body })
const refusal = (status: number, message: string): Reply => ({ ok: false, status, json: async () => ({ message }) })

let replies: Record<string, Reply>
let calls: { fn: string; body: Record<string, unknown> }[]

beforeEach(async () => {
  await i18n.changeLanguage('de')
  replies = { get_challenge: ok(challenge), submit_lead: ok({ ok: true }), log_event: ok(null) }
  calls = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, options: { body: string }) => {
      const fn = url.split('/rpc/')[1]
      calls.push({ fn, body: JSON.parse(options.body) })
      return replies[fn]
    }),
  )
  vi.stubEnv('VITE_SUPABASE_URL', 'https://demo.supabase.co')
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'sb_publishable_test')
  vi.useFakeTimers({ toFake: ['Date'] })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

async function reachWaitlistStep() {
  const user = userEvent.setup()
  render(
    <MemoryRouter initialEntries={['/finden']}>
      <App />
    </MemoryRouter>,
  )
  await user.click(screen.getByRole('button', { name: /Aufbauen & Montieren/ }))
  await user.click(screen.getByRole('button', { name: 'Weiter' }))
  await user.type(screen.getByLabelText('Deine Postleitzahl'), '10115')
  await user.click(screen.getByRole('button', { name: 'Weiter' }))
  await user.click(screen.getByRole('button', { name: /Ja, will ich haben!/ }))
  await user.type(screen.getByLabelText('Deine E-Mail-Adresse'), 'anna@posteo.de')
  await user.click(screen.getByRole('checkbox', { name: /Ich bin einverstanden/ }))
  vi.advanceTimersByTime(HUMAN_PAUSE_MS)
  return user
}

const submitButton = () => screen.getByRole('button', { name: 'Auf die Warteliste' })
const robotBox = () => screen.getByRole('checkbox', { name: 'Ich bin kein Roboter' })
const leadCalls = () => calls.filter((call) => call.fn === 'submit_lead')

describe('"I am not a robot" check', () => {
  it('keeps the submit button locked until the box is ticked, then sends the solved puzzle', async () => {
    const user = await reachWaitlistStep()
    expect(submitButton()).toBeDisabled()

    await user.click(robotBox())
    expect(await screen.findByRole('checkbox', { name: 'Bestätigt, danke!' })).toBeChecked()
    expect(submitButton()).toBeEnabled()

    await user.click(submitButton())

    expect(leadCalls()).toHaveLength(1)
    expect(leadCalls()[0].body).toMatchObject({
      p_email: 'anna@posteo.de',
      p_pow: { salt: challenge.salt, challenge: challenge.challenge, signature: challenge.signature, number: '42' },
    })
    expect(await screen.findByText('Du bist auf der Liste!')).toBeInTheDocument()
  })

  it('asks to click the mail link when the database sent a confirmation mail', async () => {
    replies.submit_lead = ok({ ok: true, confirm: true })
    const user = await reachWaitlistStep()
    await user.click(robotBox())
    await screen.findByRole('checkbox', { name: 'Bestätigt, danke!' })
    await user.click(submitButton())

    expect(await screen.findByRole('heading', { name: 'Fast geschafft!' })).toBeInTheDocument()
    expect(screen.getByText(/Bitte klick auf den Link/)).toBeInTheDocument()
    expect(screen.queryByText('Du bist auf der Liste!')).not.toBeInTheDocument()
  })

  it('explains a rate limit and keeps the confirmation', async () => {
    replies.submit_lead = refusal(429, 'rate_limited')
    const user = await reachWaitlistStep()
    await user.click(robotBox())
    await screen.findByRole('checkbox', { name: 'Bestätigt, danke!' })
    await user.click(submitButton())

    expect(await screen.findByText(/zu viele Anmeldungen/)).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Bestätigt, danke!' })).toBeChecked()
    expect(screen.queryByText('Du bist auf der Liste!')).not.toBeInTheDocument()
  })

  it('asks for a fresh tick when the puzzle expired', async () => {
    replies.submit_lead = refusal(410, 'challenge_expired')
    const user = await reachWaitlistStep()
    await user.click(robotBox())
    await screen.findByRole('checkbox', { name: 'Bestätigt, danke!' })
    await user.click(submitButton())

    expect(await screen.findByText(/Bestätigung ist abgelaufen/)).toBeInTheDocument()
    expect(robotBox()).not.toBeChecked()
    expect(submitButton()).toBeDisabled()
  })

  it('names the disposable-address rule instead of a generic failure', async () => {
    replies.submit_lead = refusal(400, 'email_not_allowed')
    const user = await reachWaitlistStep()
    await user.click(robotBox())
    await screen.findByRole('checkbox', { name: 'Bestätigt, danke!' })
    await user.click(submitButton())

    expect(await screen.findByText(/keine Wegwerfadresse/)).toBeInTheDocument()
  })

  it('tells the visitor when the puzzle itself is rate limited', async () => {
    replies.get_challenge = refusal(429, 'rate_limited')
    const user = await reachWaitlistStep()
    await user.click(robotBox())

    expect(await screen.findByText(/Zu viele Versuche von diesem Anschluss/)).toBeInTheDocument()
    expect(robotBox()).not.toBeChecked()
    expect(submitButton()).toBeDisabled()
  })
})
