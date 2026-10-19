import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import './i18n'
import { initAnalytics } from './lib/analytics'
import App from './App.tsx'

initAnalytics()

// GitHub project pages live under /<repo>/, which Vite exposes as BASE_URL.
const basename = import.meta.env.BASE_URL.replace(/\/+$/, '') || undefined

const root = createRoot(document.getElementById('root')!)

// GitHub Pages cannot send X-Frame-Options or frame-ancestors, so the app
// refuses to run inside someone else's frame (clickjacking) and links out instead.
if (window.top !== window.self) {
  root.render(
    <p style={{ padding: 16 }}>
      <a href={window.location.href} target="_blank" rel="noopener noreferrer">
        FixFlix öffnen / Open FixFlix
      </a>
    </p>,
  )
} else {
  root.render(
    <StrictMode>
      <BrowserRouter basename={basename}>
        <App />
      </BrowserRouter>
    </StrictMode>,
  )
}
