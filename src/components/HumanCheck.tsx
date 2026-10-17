import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { fetchChallenge, LeadError } from '../api/client'
import { solve, type PowProof } from '../lib/pow'

interface HumanCheckProps {
  proof: PowProof | null
  onProof: (proof: PowProof | null) => void
}

type Failure = 'error' | 'rateLimited'

/**
 * "I am not a robot" without a third party: ticking the box fetches a puzzle
 * from the database and solves it in the browser. No cookies, no tracking.
 */
export default function HumanCheck({ proof, onProof }: HumanCheckProps) {
  const { t } = useTranslation()
  const [working, setWorking] = useState(false)
  const [failure, setFailure] = useState<Failure | null>(null)

  const verify = async () => {
    setWorking(true)
    setFailure(null)
    try {
      onProof(await solve(await fetchChallenge()))
    } catch (error) {
      onProof(null)
      setFailure(error instanceof LeadError && error.kind === 'rate_limited' ? 'rateLimited' : 'error')
    } finally {
      setWorking(false)
    }
  }

  const done = proof !== null

  return (
    <div
      className={`rounded-2xl border-2 bg-white px-4 py-3 transition-colors ${
        done ? 'border-green-600/40 bg-green-50' : 'border-wood/15'
      }`}
    >
      <label className={`flex items-center gap-3 font-medium ${done || working ? '' : 'cursor-pointer'}`}>
        {working ? (
          <span
            aria-hidden="true"
            className="h-5 w-5 shrink-0 animate-spin rounded-full border-2 border-brand border-t-transparent"
          />
        ) : null}
        <input
          type="checkbox"
          checked={done}
          disabled={done || working}
          onChange={verify}
          className={`h-5 w-5 shrink-0 accent-brand ${working ? 'sr-only' : ''}`}
        />
        <span aria-live="polite">
          {working ? t('humanCheck.working') : done ? t('humanCheck.done') : t('humanCheck.label')}
        </span>
      </label>
      {failure ? (
        <p className="mt-2 text-sm text-red-700">{t(`humanCheck.${failure}`)}</p>
      ) : (
        <p className="mt-1 text-sm text-wood/70">{t('humanCheck.hint')}</p>
      )}
    </div>
  )
}
