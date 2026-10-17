import i18n from '../i18n'
import { supabaseConfig, supabaseRpc } from './supabase'

declare global {
  interface Window {
    plausible?: (event: string, options?: { props?: Record<string, string | number | boolean> }) => void
  }
}

const domain = import.meta.env.VITE_PLAUSIBLE_DOMAIN as string | undefined
const host = (import.meta.env.VITE_PLAUSIBLE_HOST as string | undefined) ?? 'https://plausible.io'

let source: string | null = null

// Same alphabet the database enforces (private.clean_source): the value comes
// straight from the URL, so it is attacker-controlled.
function cleanSource(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9._:-]/g, '')
    .slice(0, 40)
}

function detectSource(): string {
  try {
    const params = new URLSearchParams(window.location.search)
    const campaign = cleanSource(params.get('utm_source') ?? params.get('ref') ?? '')
    if (campaign) return campaign
    if (document.referrer) {
      const referrerHost = new URL(document.referrer).hostname
      if (referrerHost && referrerHost !== window.location.hostname) return cleanSource(referrerHost) || 'direct'
    }
  } catch {
    // malformed URL or referrer: treat as direct traffic
  }
  return 'direct'
}

/** Where the visitor came from (utm_source / ref / referrer host); fixed per page load. */
export function getSource(): string {
  source ??= detectSource()
  return source
}

/**
 * Loads the Plausible script only when VITE_PLAUSIBLE_DOMAIN is set,
 * so local development produces no analytics traffic.
 */
export function initAnalytics() {
  getSource()
  if (!domain) return
  const script = document.createElement('script')
  script.defer = true
  script.dataset.domain = domain
  script.src = `${host}/js/script.js`
  document.head.appendChild(script)
}

function currentPath(): string {
  const base = import.meta.env.BASE_URL.replace(/\/+$/, '')
  const path = window.location.pathname
  return (base && path.startsWith(base) ? path.slice(base.length) : path) || '/'
}

/**
 * Anonymous demand counters (no cookies, no identifiers). The database function
 * only stores names and paths from its own allowlist, so nothing free-form goes in.
 */
function recordEvent(name: string, props?: Record<string, string | number | boolean>) {
  // Dev sessions would pollute the real numbers.
  if (import.meta.env.MODE === 'development' || !supabaseConfig()) return

  supabaseRpc(
    'log_event',
    {
      p_name: name,
      p_path: currentPath(),
      p_locale: i18n.resolvedLanguage ?? 'de',
      p_source: getSource(),
      p_wants_app: typeof props?.wants_app === 'boolean' ? props.wants_app : null,
    },
    true,
  ).catch(() => {
    // analytics must never break the funnel
  })
}

export function track(event: string, props?: Record<string, string | number | boolean>) {
  window.plausible?.(event, props ? { props } : undefined)
  recordEvent(event, props)
}

/** Plausible counts page views itself, so this only feeds the Supabase events. */
export function trackPageview() {
  recordEvent('pageview')
}
