import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import BeaverMascot from '../components/BeaverMascot'

export default function Landing() {
  const { t } = useTranslation()

  return (
    <div className="mx-auto max-w-5xl px-4">
      <section className="flex flex-col items-center gap-8 py-12 text-center md:flex-row md:text-left">
        <BeaverMascot className="h-48 w-48 shrink-0 md:h-64 md:w-64" />
        <div>
          <h1 className="text-4xl font-extrabold tracking-tight md:text-5xl">{t('landing.heroTitle')}</h1>
          <p className="mt-4 text-lg text-wood">{t('landing.heroSubtitle')}</p>
        </div>
      </section>

      <section className="grid gap-6 pb-12 md:grid-cols-2">
        <div className="flex flex-col rounded-3xl bg-white p-8 shadow-sm">
          <h2 className="text-2xl font-bold">{t('landing.ctaSeekerTitle')}</h2>
          <p className="mt-2 flex-1 text-wood">{t('landing.ctaSeekerText')}</p>
          <Link
            to="/finden"
            className="mt-6 rounded-full bg-brand px-8 py-3 text-center font-semibold text-white shadow transition-colors hover:bg-brand-dark"
          >
            {t('landing.ctaSeekerButton')}
          </Link>
        </div>
        <div className="flex flex-col rounded-3xl bg-white p-8 shadow-sm">
          <h2 className="text-2xl font-bold">{t('landing.ctaHelperTitle')}</h2>
          <p className="mt-2 flex-1 text-wood">{t('landing.ctaHelperText')}</p>
          <Link
            to="/helfen"
            className="mt-6 rounded-full border-2 border-brand px-8 py-3 text-center font-semibold text-brand transition-colors hover:bg-orange-50"
          >
            {t('landing.ctaHelperButton')}
          </Link>
        </div>
      </section>

      <section className="pb-12">
        <h2 className="text-center text-2xl font-bold">{t('landing.howTitle')}</h2>
        <div className="mt-8 grid gap-6 md:grid-cols-3">
          {([1, 2, 3] as const).map((n) => (
            <div key={n} className="rounded-3xl bg-white p-6 text-center shadow-sm">
              <span className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-brand font-bold text-white">
                {n}
              </span>
              <h3 className="mt-3 font-bold">{t(`landing.how${n}Title`)}</h3>
              <p className="mt-1 text-sm text-wood">{t(`landing.how${n}Text`)}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="pb-12">
        <h2 className="text-center text-2xl font-bold">{t('landing.detailsTitle')}</h2>
        <p className="mx-auto mt-4 max-w-2xl text-center text-wood">{t('landing.detailsIntro')}</p>
        <div className="mt-8 grid gap-6 md:grid-cols-2">
          {([1, 2, 3, 4] as const).map((n) => (
            <div key={n} className="rounded-3xl bg-white p-6 shadow-sm">
              <h3 className="font-bold">{t(`landing.details${n}Title`)}</h3>
              <p className="mt-2 text-sm leading-relaxed text-wood">{t(`landing.details${n}Text`)}</p>
            </div>
          ))}
        </div>
        <p className="mt-8 text-center text-sm text-wood/70">{t('landing.legalNote')}</p>
      </section>
    </div>
  )
}
