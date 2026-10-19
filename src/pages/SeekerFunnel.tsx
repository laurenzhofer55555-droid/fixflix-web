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

export default function SeekerFunnel() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()

  const [step, setStep] = useState(1)
  const [categories, setCategories] = useState<string[]>([])
  const [description, setDescription] = useState('')
  const [plz, setPlz] = useState('')
  const [wantsApp, setWantsApp] = useState<boolean | null>(null)
  const [email, setEmail] = useState('')
  const [consent, setConsent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const guard = useBotGuard()

  useEffect(() => {
    track('funnel_start_seeker')
  }, [])

  const toggleCategory = (id: string) =>
    setCategories((prev) => (prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]))

  const nextDisabled =
    (step === 1 && categories.length === 0) ||
    (step === 2 && !isValidPlz(plz)) ||
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
      track(`step_completed_seeker_${step}`)
      if (step + 1 === TOTAL_STEPS) guard.markShown()
      setStep(step + 1)
      return
    }

    // Bots get the same success screen but never reach the database.
    if (guard.looksLikeBot()) {
      navigate('/erfolg', { state: { role: 'seeker' } })
      return
    }

    setBusy(true)
    setError(null)
    try {
      const { confirm } = await createLead({
        role: 'seeker',
        email,
        postalCode: plz,
        locale: i18n.resolvedLanguage ?? 'de',
        categories,
        description: description.trim() || undefined,
        wantsApp: wantsApp!,
        consentGiven: consent,
        proof: guard.proof,
      })
      track('waitlist_joined_seeker', { wants_app: wantsApp! })
      navigate('/erfolg', { state: { role: 'seeker', confirm } })
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
    1: t('seeker.categoriesTitle'),
    2: t('seeker.detailsTitle'),
    3: t('waitlist.seekerTitle'),
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
          <p className="mb-4 text-wood">{t('seeker.categoriesHint')}</p>
          <CategoryPicker selected={categories} onToggle={toggleCategory} />
        </>
      )}

      {step === 2 && (
        <div className="space-y-6">
          <div>
            <label htmlFor="seeker-description" className="font-semibold">
              {t('seeker.descriptionLabel')}
            </label>
            <textarea
              id="seeker-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('seeker.descriptionPlaceholder')}
              rows={4}
              maxLength={500}
              className="mt-2 w-full rounded-2xl border-2 border-wood/15 bg-white px-4 py-3 outline-none focus:border-brand"
            />
          </div>
          <div>
            <label htmlFor="seeker-plz" className="font-semibold">
              {t('seeker.plzLabel')}
            </label>
            <input
              id="seeker-plz"
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
        </div>
      )}

      {step === 3 && (
        <WaitlistStep
          role="seeker"
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
