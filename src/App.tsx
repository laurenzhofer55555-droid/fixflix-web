import { useEffect } from 'react'
import { Link, Route, Routes, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { trackPageview } from './lib/analytics'
import BeaverMascot from './components/BeaverMascot'
import LanguageSwitcher from './components/LanguageSwitcher'
import Landing from './pages/Landing'
import SeekerFunnel from './pages/SeekerFunnel'
import HelperFunnel from './pages/HelperFunnel'
import Success from './pages/Success'
import Confirm from './pages/Confirm'
import Impressum from './pages/Impressum'
import Datenschutz from './pages/Datenschutz'

export default function App() {
  const { t } = useTranslation()
  const { pathname } = useLocation()

  useEffect(() => {
    trackPageview()
  }, [pathname])

  return (
    <div className="flex min-h-svh flex-col">
      <header className="border-b border-wood/10 bg-white/70 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <Link to="/" className="flex items-center gap-2">
            <BeaverMascot className="h-10 w-10" />
            <span className="text-xl font-extrabold tracking-tight">
              Fix<span className="text-brand">Flix</span>
            </span>
          </Link>
          <LanguageSwitcher />
        </div>
      </header>

      <main className="flex-1">
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/finden" element={<SeekerFunnel />} />
          <Route path="/helfen" element={<HelperFunnel />} />
          <Route path="/erfolg" element={<Success />} />
          <Route path="/bestaetigen" element={<Confirm />} />
          <Route path="/impressum" element={<Impressum />} />
          <Route path="/datenschutz" element={<Datenschutz />} />
        </Routes>
      </main>

      <footer className="border-t border-wood/10 bg-white/70">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-2 px-4 py-4 text-sm text-wood/80">
          <span>{t('footer.note')}</span>
          <nav className="flex gap-4">
            <Link to="/impressum" className="hover:underline">
              {t('footer.imprint')}
            </Link>
            <Link to="/datenschutz" className="hover:underline">
              {t('footer.privacy')}
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  )
}
