import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

interface WizardProps {
  step: number
  totalSteps: number
  title: string
  onBack: () => void
  onNext: () => void
  nextLabel?: string
  nextDisabled?: boolean
  busy?: boolean
  children: ReactNode
}

export default function Wizard({
  step,
  totalSteps,
  title,
  onBack,
  onNext,
  nextLabel,
  nextDisabled,
  busy,
  children,
}: WizardProps) {
  const { t } = useTranslation()

  return (
    <div className="mx-auto w-full max-w-xl px-4 py-8">
      <p className="text-sm text-wood">{t('common.step', { current: step, total: totalSteps })}</p>
      <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-wood/15">
        <div
          className="h-full rounded-full bg-brand transition-all duration-300"
          style={{ width: `${(step / totalSteps) * 100}%` }}
        />
      </div>

      <h1 className="mt-6 text-2xl font-bold">{title}</h1>
      <div className="mt-6">{children}</div>

      <div className="mt-8 flex items-center justify-between">
        <button
          type="button"
          onClick={onBack}
          className="rounded-full px-5 py-2.5 font-medium text-wood hover:bg-wood/10"
        >
          {t('common.back')}
        </button>
        <button
          type="button"
          onClick={onNext}
          disabled={nextDisabled || busy}
          className="rounded-full bg-brand px-7 py-2.5 font-semibold text-white shadow transition-colors hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? '…' : (nextLabel ?? t('common.next'))}
        </button>
      </div>
    </div>
  )
}
