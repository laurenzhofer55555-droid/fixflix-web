import { Link, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import BeaverMascot from '../components/BeaverMascot'

export default function Success() {
  const { t } = useTranslation()
  const location = useLocation()
  const role: 'seeker' | 'helper' = location.state?.role === 'helper' ? 'helper' : 'seeker'

  return (
    <div className="mx-auto flex max-w-xl flex-col items-center px-4 py-16 text-center">
      <BeaverMascot className="h-40 w-40" />
      <h1 className="mt-6 text-3xl font-extrabold">{t('success.title')}</h1>
      <p className="mt-3 text-lg text-wood">{t(`success.${role}Text`)}</p>
      <Link
        to="/"
        className="mt-8 rounded-full bg-brand px-8 py-3 font-semibold text-white shadow transition-colors hover:bg-brand-dark"
      >
        {t('success.backHome')}
      </Link>
    </div>
  )
}
