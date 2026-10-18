import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import App from '../App'
import i18n from '../i18n'

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  )
}

const fetchMock = vi.fn()

beforeEach(async () => {
  await i18n.changeLanguage('de')
  fetchMock.mockReset()
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ id: 'test-id' }) })
  vi.stubGlobal('fetch', fetchMock)
  vi.useFakeTimers({ toFake: ['Date'] })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const HUMAN_PAUSE_MS = 10_000

describe('landing page', () => {
  it('shows both CTAs in German', () => {
    renderAt('/')
    expect(screen.getByRole('link', { name: 'Hilfe finden' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Helfer:in werden' })).toBeInTheDocument()
  })

  it('switches to English', async () => {
    await i18n.changeLanguage('en')
    renderAt('/')
    expect(screen.getByRole('link', { name: 'Find help' })).toBeInTheDocument()
  })

  it('explains FixFlix in detail below the short intro', () => {
    renderAt('/')
    expect(screen.getByRole('heading', { name: 'FixFlix genauer erklärt' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Wenn du Hilfe suchst' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Wenn du helfen möchtest' })).toBeInTheDocument()
  })

  it.each(['de', 'en'])('shows no dashes in %s', async (lang) => {
    await i18n.changeLanguage(lang)
    const { container } = renderAt('/')
    expect(container.textContent).not.toMatch(/[—–]/)
  })
})

describe('seeker funnel', () => {
  it('walks through all steps, reveals the app pitch only at the end, and submits a lead', async () => {
    const user = userEvent.setup()
    renderAt('/finden')

    // Step 1: categories — no app pitch visible yet
    expect(screen.queryByText('Würdest du die FixFlix App nutzen?')).not.toBeInTheDocument()
    const next = screen.getByRole('button', { name: 'Weiter' })
    expect(next).toBeDisabled()
    await user.click(screen.getByRole('button', { name: /Aufbauen & Montieren/ }))
    await user.click(next)

    // Step 2: description + postal code — still no app pitch
    expect(screen.queryByText('Würdest du die FixFlix App nutzen?')).not.toBeInTheDocument()
    await user.type(screen.getByLabelText(/Was genau ist zu tun/), 'Regal aufbauen')
    await user.type(screen.getByLabelText('Deine Postleitzahl'), '10115')
    await user.click(screen.getByRole('button', { name: 'Weiter' }))

    // Step 3: PMF reveal + waitlist
    expect(screen.getByText('Würdest du die FixFlix App nutzen?')).toBeInTheDocument()
    vi.advanceTimersByTime(HUMAN_PAUSE_MS)
    const submit = screen.getByRole('button', { name: 'Auf die Warteliste' })
    expect(submit).toBeDisabled()
    await user.click(screen.getByRole('button', { name: /Ja, will ich haben!/ }))
    await user.type(screen.getByLabelText('Deine E-Mail-Adresse'), 'test@example.com')
    await user.click(screen.getByRole('checkbox'))
    await user.click(submit)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, options] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/leads')
    expect(JSON.parse(options.body)).toMatchObject({
      role: 'seeker',
      email: 'test@example.com',
      postalCode: '10115',
      categories: ['assemble'],
      description: 'Regal aufbauen',
      wantsApp: true,
      consentGiven: true,
    })

    expect(await screen.findByText('Du bist auf der Liste!')).toBeInTheDocument()
  })
})

describe('helper funnel', () => {
  it('requires experience level and submits a helper lead', async () => {
    const user = userEvent.setup()
    renderAt('/helfen')

    await user.click(screen.getByRole('button', { name: /Kleine Reparaturen/ }))
    await user.click(screen.getByRole('button', { name: 'Weiter' }))

    const next = screen.getByRole('button', { name: 'Weiter' })
    await user.type(screen.getByLabelText('Deine Postleitzahl'), '80331')
    expect(next).toBeDisabled()
    await user.click(screen.getByRole('button', { name: /Hobby: Ich helfe gelegentlich/ }))
    await user.click(next)
    vi.advanceTimersByTime(HUMAN_PAUSE_MS)

    await user.click(screen.getByRole('button', { name: 'Eher nicht' }))
    await user.type(screen.getByLabelText('Deine E-Mail-Adresse'), 'helper@example.com')
    await user.click(screen.getByRole('checkbox'))
    await user.click(screen.getByRole('button', { name: 'Auf die Warteliste' }))

    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      role: 'helper',
      email: 'helper@example.com',
      postalCode: '80331',
      categories: ['repair'],
      experienceLevel: 'hobby',
      wantsApp: false,
      consentGiven: true,
    })

    expect(await screen.findByText('Du bist auf der Liste!')).toBeInTheDocument()
  })
})

describe('spam protection', () => {
  async function reachSeekerWaitlist() {
    const user = userEvent.setup()
    const view = renderAt('/finden')
    await user.click(screen.getByRole('button', { name: /Aufbauen & Montieren/ }))
    await user.click(screen.getByRole('button', { name: 'Weiter' }))
    await user.type(screen.getByLabelText('Deine Postleitzahl'), '10115')
    await user.click(screen.getByRole('button', { name: 'Weiter' }))
    await user.click(screen.getByRole('button', { name: /Ja, will ich haben!/ }))
    await user.type(screen.getByLabelText('Deine E-Mail-Adresse'), 'bot@example.com')
    await user.click(screen.getByRole('checkbox'))
    return { user, view }
  }

  it('silently drops submissions that fill the hidden trap field', async () => {
    const { user, view } = await reachSeekerWaitlist()
    vi.advanceTimersByTime(HUMAN_PAUSE_MS)
    await user.type(view.container.querySelector('input[name="website"]')!, 'https://spam.example')
    await user.click(screen.getByRole('button', { name: 'Auf die Warteliste' }))

    expect(fetchMock).not.toHaveBeenCalled()
    expect(await screen.findByText('Du bist auf der Liste!')).toBeInTheDocument()
  })

  it('silently drops submissions made implausibly fast', async () => {
    const { user } = await reachSeekerWaitlist()
    await user.click(screen.getByRole('button', { name: 'Auf die Warteliste' }))

    expect(fetchMock).not.toHaveBeenCalled()
    expect(await screen.findByText('Du bist auf der Liste!')).toBeInTheDocument()
  })
})
