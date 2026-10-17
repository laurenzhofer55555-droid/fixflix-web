import { useTranslation } from 'react-i18next'
import { site, siteIsConfigured } from '../config/site'

export default function Impressum() {
  const { t } = useTranslation()

  return (
    <div className="mx-auto max-w-2xl px-4 py-12">
      <h1 className="text-3xl font-extrabold">{t('legal.imprintTitle')}</h1>
      {!siteIsConfigured && <p className="mt-4 rounded-2xl bg-orange-50 p-4 text-wood">{t('legal.todo')}</p>}

      <h2 className="mt-8 font-bold">{t('legal.imprintHeading')}</h2>
      <address className="mt-2 space-y-1 text-wood not-italic">
        <p>{site.name}</p>
        <p>{site.street}</p>
        <p>{site.city}</p>
      </address>

      <h2 className="mt-8 font-bold">{t('legal.contact')}</h2>
      <p className="mt-2 text-wood">
        {t('legal.emailLabel')}:{' '}
        <a href={`mailto:${site.email}`} className="underline">
          {site.email}
        </a>
        {site.phone ? ` · ${t('legal.phoneLabel')}: ${site.phone}` : null}
      </p>
    </div>
  )
}
