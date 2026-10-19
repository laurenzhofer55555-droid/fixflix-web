import { useTranslation } from 'react-i18next'
import { site, siteIsConfigured } from '../config/site'

// The mail section only appears once confirmation mails are switched on
// (site.mailProvider here and mail_provider in the database).
const SECTIONS = ['s1', 's2', 's3', 's4', ...(site.mailProvider ? ['mail'] : []), 's5', 's6', 's7', 's8', 's9']

export default function Datenschutz() {
  const { t } = useTranslation()

  return (
    <div className="mx-auto max-w-2xl px-4 py-12">
      <h1 className="text-3xl font-extrabold">{t('legal.privacyTitle')}</h1>
      {!siteIsConfigured && <p className="mt-4 rounded-2xl bg-orange-50 p-4 text-wood">{t('legal.todo')}</p>}

      {SECTIONS.map((key, index) => (
        <section key={key} className="mt-8">
          <h2 className="font-bold">
            {index + 1}. {t(`legal.privacy.${key}Title`)}
          </h2>
          <p className="mt-2 text-wood">
            {key === 'mail' ? t(`legal.privacy.mailBody_${site.mailProvider}`) : t(`legal.privacy.${key}Body`, site)}
          </p>
        </section>
      ))}
    </div>
  )
}
