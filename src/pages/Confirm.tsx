import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import BeaverMascot from '../components/BeaverMascot'
import { confirmLead, LeadError, type ConfirmStatus } from '../api/client'

// Read once and wipe from the address bar, so the token does not linger in
// history or end up in a screenshot. The fragment never reaches any server log.
function takeToken(): string {
  const token = window.location.hash.replace(/^#/, '')
  if (token) window.history.replaceState(window.history.state, '', window.location.pathname)
  return /^[0-9a-f]{64}$/.test(token) ? token : ''
}

export default function Confirm() {
  const { t } = useTranslation()
  const [token] = useState(takeToken)
  const [status, setStatus] = useState<ConfirmStatus | null>(token ? null : 'invalid')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Confirming needs a click on purpose: mail scanners open every link in a
  // message, and an automatic confirmation would vouch for addresses nobody checked.
  const handleConfirm = async () => {
    setBusy(true)
    setError(null)
    try {
      setStatus(await confirmLead(token))
    } catch (e) {
      setError(t(`errors.${e instanceof LeadError ? e.kind : 'unknown'}`))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto flex max-w-xl flex-col items-center px-4 py-16 text-center">
      <BeaverMascot className="h-40 w-40" />
      <h1 className="mt-6 text-3xl font-extrabold">{t(status ? `confirm.${status}Title` : 'confirm.title')}</h1>
      <p className="mt-3 text-lg text-wood">{t(status ? `confirm.${status}Text` : 'confirm.text')}</p>

      {status === null && (
        <button
          type="button"
          onClick={handleConfirm}
          disabled={busy}
          className="mt-8 rounded-full bg-brand px-8 py-3 font-semibold text-white shadow transition-colors hover:bg-brand-dark disabled:opacity-50"
        >
          {busy ? t('confirm.busy') : t('confirm.button')}
        </button>
      )}
      {error && (
        <p role="alert" className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      )}
      {status !== null && (
        <Link
          to="/"
          className="mt-8 rounded-full bg-brand px-8 py-3 font-semibold text-white shadow transition-colors hover:bg-brand-dark"
        >
          {t('success.backHome')}
        </Link>
      )}
    </div>
  )
}
