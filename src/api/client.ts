import { getSource } from '../lib/analytics'
import type { PowChallenge, PowProof } from '../lib/pow'
import { RpcError, supabaseConfig, supabaseRpc } from '../lib/supabase'

export interface CreateLeadPayload {
  role: 'seeker' | 'helper'
  email: string
  postalCode: string
  locale: string
  categories: string[]
  description?: string
  experienceLevel?: 'hobby' | 'advanced' | 'pro'
  wantsApp: boolean
  consentGiven: boolean
  /** Solved "I am not a robot" puzzle; required whenever Supabase stores the lead. */
  proof?: PowProof | null
}

/** Each kind has a translation under `errors.<kind>`. */
export type LeadErrorKind =
  | 'rate_limited'
  | 'busy'
  | 'expired'
  | 'bad_challenge'
  | 'invalid_email'
  | 'email_not_allowed'
  | 'invalid'
  | 'unknown'

export class LeadError extends Error {
  kind: LeadErrorKind

  constructor(kind: LeadErrorKind) {
    super(kind)
    this.kind = kind
  }
}

function toLeadError(error: unknown): LeadError {
  if (!(error instanceof RpcError)) return new LeadError('unknown')
  if (error.status === 429) return new LeadError('rate_limited')
  if (error.status === 503) return new LeadError('busy')
  if (error.status === 410) return new LeadError('expired')
  if (error.message === 'bad_challenge') return new LeadError('bad_challenge')
  if (error.message === 'invalid_email') return new LeadError('invalid_email')
  if (error.message === 'email_not_allowed') return new LeadError('email_not_allowed')
  if (error.message.startsWith('invalid_')) return new LeadError('invalid')
  return new LeadError('unknown')
}

/** The puzzle only exists on the Supabase path; the local ASP.NET API has no public endpoint to protect. */
export function isHumanCheckRequired(): boolean {
  return supabaseConfig() !== null
}

export async function fetchChallenge(): Promise<PowChallenge> {
  try {
    return await supabaseRpc<PowChallenge>('get_challenge', {})
  } catch (error) {
    throw toLeadError(error)
  }
}

export interface CreateLeadResult {
  /** True when a confirmation mail went out and the sign-up only counts after the click. */
  confirm: boolean
}

export async function createLead(payload: CreateLeadPayload): Promise<CreateLeadResult> {
  // Static hosting (GitHub Pages) has no backend: leads go through a guarded
  // database function. Without Supabase config (local dev) the ASP.NET API takes them.
  if (supabaseConfig()) {
    try {
      const result = await supabaseRpc<{ confirm?: unknown } | null>('submit_lead', {
        p_role: payload.role,
        p_email: payload.email.trim().toLowerCase(),
        p_postal_code: payload.postalCode,
        p_locale: payload.locale,
        p_categories: payload.categories,
        p_description: payload.description ?? null,
        p_experience_level: payload.experienceLevel ?? null,
        p_wants_app: payload.wantsApp,
        p_source: getSource(),
        p_pow: payload.proof ?? null,
      })
      return { confirm: result?.confirm === true }
    } catch (error) {
      throw toLeadError(error)
    }
  }

  const response = await fetch('/api/leads', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      role: payload.role,
      email: payload.email,
      postalCode: payload.postalCode,
      locale: payload.locale,
      categories: payload.categories,
      description: payload.description,
      experienceLevel: payload.experienceLevel,
      wantsApp: payload.wantsApp,
      consentGiven: payload.consentGiven,
    }),
  })

  if (!response.ok) {
    throw new LeadError('unknown')
  }
  return { confirm: false }
}

export type ConfirmStatus = 'confirmed' | 'already_confirmed' | 'expired' | 'invalid'

/** Redeems the link from the confirmation mail. Throws LeadError for limits and outages. */
export async function confirmLead(token: string): Promise<ConfirmStatus> {
  try {
    const result = await supabaseRpc<{ status?: unknown } | null>('confirm_lead', { p_token: token })
    const status = result?.status
    return status === 'confirmed' || status === 'already_confirmed' || status === 'expired' ? status : 'invalid'
  } catch (error) {
    throw toLeadError(error)
  }
}
