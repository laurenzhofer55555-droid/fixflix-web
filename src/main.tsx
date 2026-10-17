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

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter basename={basename}>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
