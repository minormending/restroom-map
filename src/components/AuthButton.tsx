import { useState } from 'react'
import { signInWithGoogle, signOut, type Account } from '../lib/auth'

interface Props {
  account: Account | null
  balance: number | null
  onOpenProfile: () => void
}

export default function AuthButton({ account, balance, onOpenProfile }: Props) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [menu, setMenu] = useState(false)

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

  return (
    <div className="account">
      <button type="button" className="signin" disabled={busy} onClick={() => void go()}>
        {busy ? 'Opening…' : 'Sign in'}
      </button>
      {error && <p className="account-error">{error}</p>}
    </div>
  )
}
