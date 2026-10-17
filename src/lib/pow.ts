/** Puzzle issued by the database function `get_challenge`. */
export interface PowChallenge {
  salt: string
  challenge: string
  signature: string
  maxnumber: number
}

/** Solved puzzle; `submit_lead` verifies it and accepts each one only once. */
export interface PowProof {
  salt: string
  challenge: string
  signature: string
  number: string
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return bytes
}

/**
 * Finds the number whose SHA-256 (together with the salt) equals the challenge.
 * That search is the "work": cheap once for a person, expensive at spam volume.
 */
export async function solveChallenge(challenge: PowChallenge): Promise<PowProof> {
  if (!globalThis.crypto?.subtle) throw new Error('Web Crypto unavailable (needs HTTPS or localhost)')

  const target = hexToBytes(challenge.challenge)
  const encoder = new TextEncoder()

  for (let n = 0; n <= challenge.maxnumber; n++) {
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(challenge.salt + n)))
    let matches = true
    for (let i = 0; i < target.length; i++) {
      if (digest[i] !== target[i]) {
        matches = false
        break
      }
    }
    if (matches) {
      return {
        salt: challenge.salt,
        challenge: challenge.challenge,
        signature: challenge.signature,
        number: String(n),
      }
    }
  }
  throw new Error('Challenge has no solution in range')
}

/** Solves off the main thread so the page stays responsive on slow phones. */
export function solve(challenge: PowChallenge): Promise<PowProof> {
  if (typeof Worker === 'undefined') return solveChallenge(challenge)

  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./powWorker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (event: MessageEvent<{ proof?: PowProof; error?: string }>) => {
      worker.terminate()
      if (event.data.proof) resolve(event.data.proof)
      else reject(new Error(event.data.error ?? 'Proof of work failed'))
    }
    worker.onerror = (event) => {
      worker.terminate()
      reject(new Error(event.message))
    }
    worker.postMessage(challenge)
  })
}
