import { useState } from 'react'
import { submitCode } from '../lib/submissions'

interface Props {
  bathroomId: string
  currentCode: string | null
  onSaved: (code: string) => void
}

/**
 * Codes rotate, so this is "update", not "add". The old value is superseded
 * rather than overwritten, and the history stays queryable.
 */
export default function CodeEditor({ bathroomId, currentCode, onSaved }: Props) {
  const [open, setOpen] = useState(false)
  const [code, setCode] = useState(currentCode ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!open) {
    return (
      <button type="button" className="linkish code-edit" onClick={() => setOpen(true)}>
        {currentCode ? 'Code changed?' : 'Add the code'}
      </button>
    )
  }

  const save = async () => {
    setBusy(true)
    setError(null)
    try {
      await submitCode(bathroomId, code.trim())
      onSaved(code.trim())
      setOpen(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save that.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="code-form">
      <input
        value={code}
        maxLength={40}
        placeholder="New code"
        aria-label="Door code"
        onChange={(e) => setCode(e.target.value)}
      />
      {error && <p className="report-error">{error}</p>}
      <div className="placing-actions">
        <button type="button" className="btn-quiet" onClick={() => setOpen(false)}>Cancel</button>
        <button type="button" className="btn-primary"
                disabled={busy || code.trim().length === 0}
                onClick={() => void save()}>
          {busy ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  )
}
