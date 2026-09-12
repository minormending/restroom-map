import { useState } from 'react'
import { unlockCode } from '../lib/credits'
import type { Account } from '../lib/auth'

interface Props {
  bathroomId: string
  cost: number
  account: Account | null
  onUnlocked: (code: string) => void
  onSpent: () => void
}

export default function UnlockCode({
  bathroomId, cost, account, onUnlocked, onSpent,
}: Props) {
  const [busy, setBusy] = useState(false)
  const [short, setShort] = useState<{ balance: number } | null>(null)
  const [error, setError] = useState<string | null>(null)

  if (!account) {
    return <p className="locked-note">Sign in to unlock this code.</p>
  }

  const go = async () => {
    setBusy(true)
    setError(null)
    setShort(null)
    try {
      const res = await unlockCode(bathroomId)
      if (res.ok && res.code) {
        onUnlocked(res.code)
        onSpent()
      } else if (!res.ok) {
        setShort({ balance: res.balance ?? 0 })
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't unlock that.")
    } finally {
      setBusy(false)
    }
  }

  if (short) {
    return (
      <p className="locked-note">
        You have {short.balance} credit{short.balance === 1 ? '' : 's'}; this costs {cost}.
        Add a place or a code someone confirms to earn more.
      </p>
    )
  }

  return (
    <>
      <button type="button" className="btn-primary unlock" disabled={busy} onClick={() => void go()}>
        {busy ? 'Unlocking…' : `Unlock for ${cost} credit${cost === 1 ? '' : 's'}`}
      </button>
      <p className="locked-note">Unlock once and it stays unlocked.</p>
      {error && <p className="report-error">{error}</p>}
    </>
  )
}
