import { copyFileSync } from 'node:fs'

// GitHub Pages answers unknown paths with 404.html; serving the app shell
// there lets any client-side route survive a page reload.
copyFileSync('dist/index.html', 'dist/404.html')

// Known routes (keep in sync with src/App.tsx) also get their own copy, which
// Pages serves for "/impressum" etc. with status 200: search engines and
// Impressum checkers ignore pages that answer 404.
for (const route of ['finden', 'helfen', 'erfolg', 'bestaetigen', 'impressum', 'datenschutz']) {
  copyFileSync('dist/index.html', `dist/${route}.html`)
}
