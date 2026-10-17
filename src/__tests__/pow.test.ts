// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { solveChallenge, type PowChallenge } from '../lib/pow'

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

// Mirrors public.get_challenge in supabase/schema.sql: challenge = sha256(salt || number).
async function challengeHiding(number: number, maxnumber: number): Promise<PowChallenge> {
  const salt = '0123456789abcdef01234567.1900000000'
  return { salt, challenge: await sha256Hex(salt + number), signature: 'e'.repeat(64), maxnumber }
}

describe('solveChallenge', () => {
  it('finds the hidden number and returns it with the untouched challenge', async () => {
    const challenge = await challengeHiding(137, 500)

    expect(await solveChallenge(challenge)).toEqual({
      salt: challenge.salt,
      challenge: challenge.challenge,
      signature: challenge.signature,
      number: '137',
    })
  })

  it('handles the edges of the range', async () => {
    expect((await solveChallenge(await challengeHiding(0, 10))).number).toBe('0')
    expect((await solveChallenge(await challengeHiding(10, 10))).number).toBe('10')
  })

  it('gives up when the number lies outside the range', async () => {
    await expect(solveChallenge(await challengeHiding(900, 50))).rejects.toThrow('no solution')
  })
})
