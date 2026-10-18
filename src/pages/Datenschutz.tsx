import { useTranslation } from 'react-i18next'
import { site, siteIsConfigured } from '../config/site'

const SECTIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const

export default function Datenschutz() {
  const { t } = useTranslation()

  return (
    <div className="mx-auto max-w-2xl px-4 py-12">
      <h1 className="text-3xl font-extrabold">{t('legal.privacyTitle')}</h1>
      {!siteIsConfigured && <p className="mt-4 rounded-2xl bg-orange-50 p-4 text-wood">{t('legal.todo')}</p>}

      {SECTIONS.map((n) => (
        <section key={n} className="mt-8">
          <h2 className="font-bold">
            {n}. {t(`legal.privacy.s${n}Title`)}
          </h2>
          <p className="mt-2 text-wood">{t(`legal.privacy.s${n}Body`, site)}</p>
        </section>
      ))}
    </div>
  )
}
