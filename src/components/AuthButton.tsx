import { useState } from 'react'
import { signInWithGoogle, signOut, type Account } from '../lib/auth'
import { SUPABASE_URL } from '../lib/config'
import { useEscape } from '../lib/useEscape'

/** The host Google will name. Derived, so it cannot go stale in a string. */
const AUTH_HOST = SUPABASE_URL.replace(/^https?:\/\//, '').replace(/\/.*$/, '')

interface Props {
  account: Account | null
  balance: number | null
  onOpenProfile: () => void
}

export default function AuthButton({ account, balance, onOpenProfile }: Props) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [menu, setMenu] = useState(false)
  const [warned, setWarned] = useState(false)

  useEscape(() => { setMenu(false); setWarned(false) })

  if (account) {
    return (
      <div className="account">
        <button type="button" className="account-chip" onClick={() => setMenu((m) => !m)}>
          {account.avatar
            ? <img src={account.avatar} alt="" width={22} height={22} />
            : <span className="account-initial" aria-hidden="true">{account.name[0]}</span>}
          <span className="account-name">{account.name}</span>
          {balance !== null && <span className="account-credits">{balance}</span>}
        </button>
        {menu && (
          <div className="account-menu">
            <button type="button" onClick={() => { setMenu(false); onOpenProfile() }}>
              Your credits
            </button>
            <button type="button" onClick={() => void signOut()}>Sign out</button>
          </div>
        )}
      </div>
    )
  }

  const go = async () => {
    setBusy(true)
    setError(null)
    try {
      await signInWithGoogle()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sign-in failed.')
      setBusy(false)
    }
  }

  /**
   * One step before Google, because of what Google is about to say.
   *
   * The consent screen reads "to continue to <project>.supabase.co" — the
   * database host, not this app. Google shows the app name only when it can
   * tie the callback to a domain the project owns and has verified, and
   * supabase.co is not ours to verify. Setting the app name does not help;
   * the fix is a custom auth domain, which is a paid add-on on a paid plan
   * and a domain we do not yet have.
   *
   * Until then, somebody taps Sign in and lands on a Google password page
   * naming a host they have never seen. That reads as phishing, and being
   * told a second before is the whole difference between alarming and
   * expected. It costs one tap on the flow this project most needs people to
   * finish, which is the trade.
   */
  return (
    <div className="account">
      <button
        type="button"
        className="signin"
        disabled={busy}
        aria-expanded={warned}
        onClick={() => (warned ? void go() : setWarned(true))}
      >
        {busy ? 'Opening…' : 'Sign in'}
      </button>

      {warned && !busy && (
        <div className="account-menu signin-warn" role="status">
          <p>Google will say you are signing in to:</p>
          <p className="signin-warn-host">{AUTH_HOST}</p>
          <p>That is this map's database, not somebody else's site.</p>
          <p className="signin-warn-note">
            Your Google password is never seen by this app.
          </p>
          <div className="signin-warn-actions">
            <button type="button" className="btn-quiet" onClick={() => setWarned(false)}>
              Cancel
            </button>
            <button type="button" className="btn-primary" onClick={() => void go()}>
              Continue
            </button>
          </div>
        </div>
      )}

      {error && <p className="account-error">{error}</p>}
    </div>
  )
}
