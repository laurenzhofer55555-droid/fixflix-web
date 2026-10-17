import { copyFileSync } from 'node:fs'

// GitHub Pages answers unknown paths with 404.html; serving the app shell
// there lets client-side routes like /finden survive a page reload.
copyFileSync('dist/index.html', 'dist/404.html')
