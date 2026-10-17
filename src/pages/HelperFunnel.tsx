import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import Wizard from '../components/Wizard'
import CategoryPicker from '../components/CategoryPicker'
import WaitlistStep from '../components/WaitlistStep'
import { createLead, isHumanCheckRequired, LeadError } from '../api/client'
import { track } from '../lib/analytics'
import { useBotGuard } from '../lib/botGuard'
import { isValidEmail, isValidPlz } from '../lib/validation'

const TOTAL_STEPS = 3
const LEVELS = ['hobby', 'advanced', 'pro'] as const
type Level = (typeof LEVELS)[number]

export default function HelperFunnel() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()

  const [step, setStep] = useState(1)
  const [categories, setCategories] = useState<string[]>([])
  const [plz, setPlz] = useState('')
  const [level, setLevel] = useState<Level | null>(null)
  const [wantsApp, setWantsApp] = useState<boolean | null>(null)
  const [email, setEmail] = useState('')
  const [consent, setConsent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const guard = useBotGuard()

  useEffect(() => {
    track('funnel_start_helper')
  }, [])

  const toggleCategory = (id: string) =>
    setCategories((prev) => (prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]))

  const nextDisabled =
    (step === 1 && categories.length === 0) ||
    (step === 2 && (!isValidPlz(plz) || level === null)) ||
    (step === 3 &&
      (wantsApp === null || !isValidEmail(email) || !consent || (isHumanCheckRequired() && guard.proof === null)))

  const handleBack = () => {
    if (step === 1) {
      navigate('/')
    } else {
      setStep(step - 1)
    }
  }

  const handleNext = async () => {
    if (step < TOTAL_STEPS) {
      track(`step_completed_helper_${step}`)
      if (step + 1 === TOTAL_STEPS) guard.markShown()
      setStep(step + 1)
      return
    }

    // Bots get the same success screen but never reach the database.
    if (guard.looksLikeBot()) {
      navigate('/erfolg', { state: { role: 'helper' } })
      return
    }

    setBusy(true)
    setError(null)
    try {
      await createLead({
        role: 'helper',
        email,
        postalCode: plz,
        locale: i18n.resolvedLanguage ?? 'de',
        categories,
        experienceLevel: level!,
        wantsApp: wantsApp!,
        consentGiven: consent,
        proof: guard.proof,
      })
      track('waitlist_joined_helper', { wants_app: wantsApp! })
      navigate('/erfolg', { state: { role: 'helper' } })
    } catch (e) {
      const kind = e instanceof LeadError ? e.kind : 'unknown'
      // A puzzle is single-use and short-lived: ask for a fresh tick.
      if (kind === 'expired' || kind === 'bad_challenge') guard.setProof(null)
      setError(t(`errors.${kind}`))
    } finally {
      setBusy(false)
    }
  }

  const titles: Record<number, string> = {
    1: t('helper.categoriesTitle'),
    2: t('helper.detailsTitle'),
    3: t('waitlist.helperTitle'),
  }

  return (
    <Wizard
      step={step}
      totalSteps={TOTAL_STEPS}
      title={titles[step]}
      onBack={handleBack}
      onNext={handleNext}
      nextDisabled={nextDisabled}
      busy={busy}
      nextLabel={step === TOTAL_STEPS ? t('waitlist.submit') : undefined}
    >
      {step === 1 && (
        <>
          <p className="mb-4 text-wood">{t('helper.categoriesHint')}</p>
          <CategoryPicker selected={categories} onToggle={toggleCategory} />
        </>
      )}

      {step === 2 && (
        <div className="space-y-6">
          <div>
            <label htmlFor="helper-plz" className="font-semibold">
              {t('helper.plzLabel')}
            </label>
            <input
              id="helper-plz"
              type="text"
              inputMode="numeric"
              value={plz}
              onChange={(e) => setPlz(e.target.value)}
              placeholder="10115"
              maxLength={5}
              className="mt-2 w-40 rounded-2xl border-2 border-wood/15 bg-white px-4 py-3 outline-none focus:border-brand"
            />
            {plz.length > 0 && !isValidPlz(plz) && (
              <p className="mt-1 text-sm text-red-700">{t('common.plzInvalid')}</p>
            )}
          </div>

          <fieldset>
            <legend className="font-semibold">{t('helper.levelLabel')}</legend>
            <div className="mt-3 space-y-3">
              {LEVELS.map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={level === value}
                  onClick={() => setLevel(value)}
                  className={`block w-full rounded-2xl border-2 bg-white px-4 py-3 text-left font-medium transition-colors ${
                    level === value ? 'border-brand bg-orange-50' : 'border-wood/15 hover:border-wood/40'
                  }`}
                >
                  {t(`helper.level${value.charAt(0).toUpperCase() + value.slice(1)}`)}
                </button>
              ))}
            </div>
          </fieldset>
        </div>
      )}

      {step === 3 && (
        <WaitlistStep
          role="helper"
          wantsApp={wantsApp}
          onWantsApp={setWantsApp}
          email={email}
          onEmail={setEmail}
          consent={consent}
          onConsent={setConsent}
          trap={guard.trap}
          onTrap={guard.setTrap}
          proof={guard.proof}
          onProof={guard.setProof}
          error={error}
        />
      )}
    </Wizard>
  )
}
