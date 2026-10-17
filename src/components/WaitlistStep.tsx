import { Trans, useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { isHumanCheckRequired } from '../api/client'
import type { PowProof } from '../lib/pow'
import BeaverMascot from './BeaverMascot'
import HumanCheck from './HumanCheck'

interface WaitlistStepProps {
  role: 'seeker' | 'helper'
  wantsApp: boolean | null
  onWantsApp: (value: boolean) => void
  email: string
  onEmail: (value: string) => void
  consent: boolean
  onConsent: (value: boolean) => void
  trap: string
  onTrap: (value: string) => void
  proof: PowProof | null
  onProof: (proof: PowProof | null) => void
  error: string | null
}

export default function WaitlistStep({
  role,
  wantsApp,
  onWantsApp,
  email,
  onEmail,
  consent,
  onConsent,
  trap,
  onTrap,
  proof,
  onProof,
  error,
}: WaitlistStepProps) {
  const { t } = useTranslation()

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-4 rounded-2xl bg-white p-5 shadow-sm">
        <BeaverMascot className="h-20 w-20 shrink-0" />
        <p className="text-wood">{t(`waitlist.${role}Text`)}</p>
      </div>

      <fieldset>
        <legend className="font-semibold">{t('waitlist.wantsAppQuestion')}</legend>
        <div className="mt-3 flex gap-3">
          <button
            type="button"
            aria-pressed={wantsApp === true}
            onClick={() => onWantsApp(true)}
            className={`flex-1 rounded-2xl border-2 bg-white px-4 py-3 font-medium transition-colors ${
              wantsApp === true ? 'border-brand bg-orange-50' : 'border-wood/15 hover:border-wood/40'
            }`}
          >
            🦫 {t('waitlist.wantsAppYes')}
          </button>
          <button
            type="button"
            aria-pressed={wantsApp === false}
            onClick={() => onWantsApp(false)}
            className={`flex-1 rounded-2xl border-2 bg-white px-4 py-3 font-medium transition-colors ${
              wantsApp === false ? 'border-brand bg-orange-50' : 'border-wood/15 hover:border-wood/40'
            }`}
          >
            {t('waitlist.wantsAppNo')}
          </button>
        </div>
      </fieldset>

      <div>
        <label htmlFor="waitlist-email" className="font-semibold">
          {t('waitlist.emailLabel')}
        </label>
        <input
          id="waitlist-email"
          type="email"
          value={email}
          onChange={(e) => onEmail(e.target.value)}
          placeholder={t('waitlist.emailPlaceholder')}
          className="mt-2 w-full rounded-2xl border-2 border-wood/15 bg-white px-4 py-3 outline-none focus:border-brand"
        />
        <p className="mt-1 text-sm text-wood/70">{t('waitlist.emailHint')}</p>
      </div>

      <label className="flex items-start gap-3 text-sm text-wood">
        <input
          type="checkbox"
          checked={consent}
          onChange={(e) => onConsent(e.target.checked)}
          className="mt-0.5 h-5 w-5 accent-brand"
        />
        <span>
          <Trans
            i18nKey="waitlist.consent"
            components={{ privacy: <Link to="/datenschutz" className="underline" /> }}
          />
        </span>
      </label>

      {isHumanCheckRequired() && <HumanCheck proof={proof} onProof={onProof} />}

      <div aria-hidden="true" className="absolute left-[-9999px] h-0 w-0 overflow-hidden">
        <label>
          Website
          <input
            type="text"
            name="website"
            tabIndex={-1}
            autoComplete="off"
            value={trap}
            onChange={(e) => onTrap(e.target.value)}
          />
        </label>
      </div>

      {error && <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
    </div>
  )
}
