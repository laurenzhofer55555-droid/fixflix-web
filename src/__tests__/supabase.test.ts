import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createLead, LeadError, type CreateLeadPayload } from '../api/client'
import { track } from '../lib/analytics'

const fetchMock = vi.fn()

const proof = { salt: 'a'.repeat(24) + '.1900000000', challenge: 'c'.repeat(64), signature: 'd'.repeat(64), number: '42' }

const lead: CreateLeadPayload = {
  role: 'seeker',
  email: '  Test@Example.com ',
  postalCode: '10115',
  locale: 'de',
  categories: ['repair'],
  description: 'Regal aufbauen',
  wantsApp: true,
  consentGiven: true,
  proof,
}

function refusal(status: number, message: string) {
  return { ok: false, status, json: async () => ({ code: `PT${status}`, message }) }
}

beforeEach(() => {
  fetchMock.mockReset()
  fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true }) })
  vi.stubGlobal('fetch', fetchMock)
  vi.stubEnv('VITE_SUPABASE_URL', 'https://demo.supabase.co/')
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'sb_publishable_test')
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('createLead with Supabase configured', () => {
  it('calls the guarded database function, never a table', async () => {
    await createLead(lead)

    const [url, options] = fetchMock.mock.calls[0]
    expect(url).toBe('https://demo.supabase.co/rest/v1/rpc/submit_lead')
    expect(options.headers).toMatchObject({ apikey: 'sb_publishable_test' })
    expect(options.headers).not.toHaveProperty('Authorization')
    expect(JSON.parse(options.body)).toEqual({
      p_role: 'seeker',
      p_email: 'test@example.com',
      p_postal_code: '10115',
      p_locale: 'de',
      p_categories: ['repair'],
      p_description: 'Regal aufbauen',
      p_experience_level: null,
      p_wants_app: true,
      p_source: 'direct',
      p_pow: proof,
    })
  })

  it('also sends legacy JWT anon keys as bearer token', async () => {
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'eyJhbGciOi.test.signature')
    await createLead(lead)

    expect(fetchMock.mock.calls[0][1].headers).toMatchObject({
      Authorization: 'Bearer eyJhbGciOi.test.signature',
    })
  })

  it.each([
    [429, 'rate_limited', 'rate_limited'],
    [503, 'busy', 'busy'],
    [410, 'challenge_expired', 'expired'],
    [400, 'bad_challenge', 'bad_challenge'],
    [400, 'invalid_email', 'invalid_email'],
    [400, 'email_not_allowed', 'email_not_allowed'],
    [400, 'invalid_postal_code', 'invalid'],
    [500, 'boom', 'unknown'],
  ])('maps a %i "%s" refusal to the "%s" error', async (status, message, kind) => {
    fetchMock.mockResolvedValue(refusal(status, message))

    const error = await createLead(lead).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(LeadError)
    expect((error as LeadError).kind).toBe(kind)
  })

  it('reports a network failure as an unknown error', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))

    await expect(createLead(lead)).rejects.toMatchObject({ kind: 'unknown' })
  })

  it('falls back to the ASP.NET API when Supabase is not configured', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', '')
    await createLead(lead)

    const [url, options] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/leads')
    expect(JSON.parse(options.body)).not.toHaveProperty('proof')
  })
})

describe('track', () => {
  it('sends only allowlisted fields to the event function', () => {
    track('waitlist_joined_seeker', { wants_app: true, anything: '<script>' })

    const [url, options] = fetchMock.mock.calls[0]
    expect(url).toBe('https://demo.supabase.co/rest/v1/rpc/log_event')
    expect(JSON.parse(options.body)).toEqual({
      p_name: 'waitlist_joined_seeker',
      p_path: '/',
      p_locale: expect.stringMatching(/^(de|en)$/),
      p_source: 'direct',
      p_wants_app: true,
    })
    expect(options.keepalive).toBe(true)
  })

  it('stays silent without Supabase config', () => {
    vi.stubEnv('VITE_SUPABASE_URL', '')
    track('funnel_start_seeker')

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('never lets a rejected event surface as an error', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))

    expect(() => track('pageview')).not.toThrow()
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
})

describe('traffic source', () => {
  afterEach(() => {
    window.history.replaceState({}, '', '/')
    vi.resetModules()
  })

  it('strips everything but a safe alphabet from utm_source', async () => {
    window.history.replaceState({}, '', '/?utm_source=Insta%3Cscript%3Egram%22%3B%20DROP')
    vi.resetModules()
    const { getSource } = await import('../lib/analytics')

    expect(getSource()).toBe('instascriptgramdrop')
  })

  it('caps the length', async () => {
    window.history.replaceState({}, '', `/?utm_source=${'a'.repeat(500)}`)
    vi.resetModules()
    const { getSource } = await import('../lib/analytics')

    expect(getSource()).toHaveLength(40)
  })
})
