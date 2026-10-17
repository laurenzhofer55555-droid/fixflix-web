import { useTranslation } from 'react-i18next'

const LANGUAGES = ['de', 'en'] as const

export default function LanguageSwitcher() {
  const { i18n } = useTranslation()
  const current = i18n.resolvedLanguage

  return (
    <div className="flex gap-1 rounded-full border border-wood/20 bg-white p-1">
      {LANGUAGES.map((lng) => (
        <button
          key={lng}
          type="button"
          onClick={() => i18n.changeLanguage(lng)}
          className={`rounded-full px-3 py-1 text-sm font-medium transition-colors ${
            current === lng ? 'bg-brand text-white' : 'text-wood hover:bg-cream'
          }`}
        >
          {lng.toUpperCase()}
        </button>
      ))}
    </div>
  )
}
