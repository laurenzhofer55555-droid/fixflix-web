import { useTranslation } from 'react-i18next'
import { CATEGORIES, CATEGORY_ICONS } from '../lib/categories'

interface CategoryPickerProps {
  selected: string[]
  onToggle: (id: string) => void
}

export default function CategoryPicker({ selected, onToggle }: CategoryPickerProps) {
  const { t } = useTranslation()

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {CATEGORIES.map((id) => {
        const isSelected = selected.includes(id)
        return (
          <button
            key={id}
            type="button"
            aria-pressed={isSelected}
            onClick={() => onToggle(id)}
            className={`flex items-center gap-3 rounded-2xl border-2 bg-white px-4 py-3 text-left font-medium transition-colors ${
              isSelected ? 'border-brand bg-orange-50' : 'border-wood/15 hover:border-wood/40'
            }`}
          >
            <span className="text-2xl" aria-hidden>
              {CATEGORY_ICONS[id]}
            </span>
            {t(`categories.${id}`)}
          </button>
        )
      })}
    </div>
  )
}
