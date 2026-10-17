// Neutral activity categories — must stay in sync with AllowedCategories
// in backend/FixFlix.Api/Endpoints/LeadEndpoints.cs.
export const CATEGORIES = [
  'assemble',
  'repair',
  'mount',
  'paint',
  'garden',
  'transport',
  'household',
] as const

export type CategoryId = (typeof CATEGORIES)[number]

export const CATEGORY_ICONS: Record<CategoryId, string> = {
  assemble: '🔧',
  repair: '🛠️',
  mount: '🖼️',
  paint: '🎨',
  garden: '🌿',
  transport: '📦',
  household: '🧹',
}
