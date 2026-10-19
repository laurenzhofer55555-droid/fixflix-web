import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

function originOf(value: string | undefined): string {
  try {
    return value ? new URL(value).origin : ''
  } catch {
    return ''
  }
}

/**
 * GitHub Pages cannot send HTTP headers, so the build writes the security
 * policies into index.html. The page may only load its own files and talk to
 * Supabase; injected markup could neither run scripts nor send data elsewhere.
 * frame-ancestors and HSTS only work as real headers: main.tsx refuses to run
 * inside a foreign frame instead.
 */
export function securityMeta(env: Record<string, string | undefined>): Plugin {
  const supabase = originOf(env.VITE_SUPABASE_URL)
  const plausible = env.VITE_PLAUSIBLE_DOMAIN ? originOf(env.VITE_PLAUSIBLE_HOST || 'https://plausible.io') : ''
  const sources = (...extra: string[]) => ["'self'", ...extra.filter(Boolean)].join(' ')

  const csp = [
    "default-src 'none'",
    `script-src ${sources(plausible)}`,
    "style-src 'self'",
    "img-src 'self' data:",
    "font-src 'self'",
    `connect-src ${sources(supabase, plausible)}`,
    "worker-src 'self'",
    "manifest-src 'self'",
    "base-uri 'none'",
    "form-action 'none'",
    "object-src 'none'",
    'upgrade-insecure-requests',
  ].join('; ')

  return {
    name: 'fixflix-security-meta',
    apply: 'build',
    transformIndexHtml: () => [
      { tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: csp }, injectTo: 'head-prepend' },
      { tag: 'meta', attrs: { name: 'referrer', content: 'no-referrer' }, injectTo: 'head-prepend' },
    ],
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  // CI sets VITE_BASE=/<repo>/ for GitHub project pages.
  base: process.env.VITE_BASE || '/',
  plugins: [react(), tailwindcss(), securityMeta(loadEnv(mode, process.cwd(), 'VITE_'))],
  server: {
    proxy: {
      '/api': 'http://localhost:5258',
    },
  },
}))
