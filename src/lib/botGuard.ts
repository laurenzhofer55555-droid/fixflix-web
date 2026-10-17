import { useRef, useState } from 'react'
import type { PowProof } from './pow'

const MIN_MS_ON_LAST_STEP = 2500

/**
 * Client half of the spam defence: a hidden field humans never fill, a minimum
 * dwell time on the final step, and the solved "I am not a robot" puzzle. The
 * binding checks (puzzle, rate limits, validation) run in the database.
 */
export function useBotGuard() {
  const [trap, setTrap] = useState('')
  const [proof, setProof] = useState<PowProof | null>(null)
  const shownAt = useRef<number | null>(null)

  return {
    trap,
    setTrap,
    proof,
    setProof,
    markShown: () => {
      shownAt.current = Date.now()
    },
    looksLikeBot: () =>
      trap !== '' || shownAt.current === null || Date.now() - shownAt.current < MIN_MS_ON_LAST_STEP,
  }
}
