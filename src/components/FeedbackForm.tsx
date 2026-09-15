import { useState } from 'react'
import { USING_SEED_DATA } from '../lib/config'
import {
  FEEDBACK_KINDS, FEEDBACK_LABELS, sendFeedback, type FeedbackKind,
} from '../lib/feedback'

/**
 * The complaint box.
 *
 * It replaced a link to the issue tracker, which worked for the people least
 * likely to need it — a developer with GitHub already open — and asked
 * everybody else to make an account before they could tell us a door code was
 * wrong. So this asks for nothing: no sign-in, no address unless somebody
 * wants an answer back.
 *
 * Three buttons rather than a dropdown, because the first question is the one
 * people can answer instantly and a select on a phone is a modal of its own.
 * The kind is mostly for sorting the queue; the message is the thing.
 */
export default function FeedbackForm() {
  const [kind, setKind] = useState<FeedbackKind>('bug')
  const [message, setMessage] = useState('')
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (USING_SEED_DATA) {
    return (
      <p className="menu-note">
        Sample data — sending feedback needs a database connection.
      </p>
    )
  }

  if (sent) {
    return (
      <p className="feedback-done" role="status" aria-live="polite">
        Sent, thank you. {email.trim()
          ? 'Somebody will reply to that address.'
          : 'Add an address next time if you want an answer back.'}
      </p>
    )
  }

  const send = async () => {
    setBusy(true)
    setError(null)
    try {
      await sendFeedback({ kind, message, email })
      setSent(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't send that.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="feedback">
      <fieldset className="feedback-kind">
        <legend>What is it?</legend>
        <div className="chips">
          {FEEDBACK_KINDS.map((k) => (
            <button
              key={k}
              type="button"
              className={k === kind ? 'chip is-on' : 'chip'}
              aria-pressed={k === kind}
              onClick={() => setKind(k)}
            >
              {FEEDBACK_LABELS[k]}
            </button>
          ))}
        </div>
      </fieldset>

      <label className="field">
        <span>What happened?</span>
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={4}
          maxLength={2000}
          placeholder="The more specific the better — which place, which button, what you expected."
        />
      </label>

      <label className="field">
        <span>Your email <em>only if you want a reply</em></span>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          maxLength={200}
          autoComplete="email"
          placeholder="Leave blank to stay anonymous"
        />
      </label>

      {error && <p className="report-error">{error}</p>}

      <button
        type="button"
        className="btn-primary feedback-send"
        disabled={busy || message.trim().length === 0}
        onClick={() => void send()}
      >
        {busy ? 'Sending…' : 'Send'}
      </button>
    </div>
  )
}
