import { useState } from 'react'
import {
  ACCESS_FIELDS, FIELD_NAMES, FIELD_OPTIONS, FIELD_QUESTIONS,
  answerLabel, describe, settledValue, type AccessField,
} from '../lib/access'
import { USING_SEED_DATA } from '../lib/config'
import { submitAccessClaim } from '../lib/claims'
import type { Account } from '../lib/auth'
import type { Bathroom } from '../lib/types'

interface Props {
  bathroom: Bathroom
  account: Account | null
}

const MARKS = { yes: '✓', partial: '!', no: '×', unknown: '?' } as const

/**
 * The accessibility picture, in three tiers, because the three mean different
 * things and flattening them would be the lie this whole model exists to avoid.
 *
 *   settled      an import, or two people who agree. Stated as fact.
 *   claimed      one account, or a disagreement. Stated with its evidence
 *                attached, because "one person said so" is what the reader
 *                needs in order to weigh it.
 *   unrecorded   named, so the gap is specific and answerable.
 *
 * The last tier is the reason the app exists. Nobody else records this, which
 * is why it is an invitation rather than an apology.
 */
export default function AccessDetail({ bathroom, account }: Props) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [answered, setAnswered] = useState<Set<string>>(() => new Set())

  const claims = bathroom.claims ?? []
  const claimFor = (f: AccessField) => claims.filter((c) => c.field === f)

  const settled: [AccessField, ReturnType<typeof describe>][] = []
  const claimed: AccessField[] = []
  const missing: AccessField[] = []

  for (const field of ACCESS_FIELDS) {
    const value = settledValue(bathroom, field)
    if (value != null) {
      const fact = describe(field, value)
      // A settled "no" on most fields is noise — nine rows of crosses buries
      // the three answers somebody came for. A locked stall is the exception:
      // that negative is the whole decision.
      if (fact[0] !== 'no' || field === 'accessible_locked') settled.push([field, fact])
      continue
    }
    if (claimFor(field).length > 0) claimed.push(field)
    else if (!answered.has(field)) missing.push(field)
  }

  const send = async (field: AccessField, value: string) => {
    setBusy(field)
    setError(null)
    try {
      const res = await submitAccessClaim(bathroom.id, field, value)
      if (res.ok) {
        setAnswered((a) => new Set(a).add(field))
      } else {
        setError('Somebody settled that one first.')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save that.")
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="access" aria-label="Accessibility">
      {settled.length > 0 && (
        <ul className="amenities">
          {settled.map(([field, [state, label]]) => (
            <li key={field} className={state}>
              <span className="amenity-mark" aria-hidden="true">{MARKS[state]}</span>
              {label}
            </li>
          ))}
        </ul>
      )}

      {claimed.length > 0 && (
        <div className="claimed">
          <span className="claimed-label">Reported, not yet confirmed</span>
          <ul>
            {claimed.map((field) => {
              const rows = claimFor(field)
              const disputed = rows.some((r) => r.disputed)
              return (
                <li key={field} className={disputed ? 'is-disputed' : undefined}>
                  <strong>{FIELD_NAMES[field]}</strong>
                  {disputed ? (
                    <> — people disagree: {rows
                      .map((r) => `${answerLabel(field, r.value).toLowerCase()} (${r.claims})`)
                      .join(', ')}</>
                  ) : (
                    <> — {answerLabel(field, rows[0].value).toLowerCase()}, on one person’s word</>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {missing.length > 0 && !open && (
        <p className="unrecorded">
          <span className="unrecorded-label">Nobody has recorded</span>
          {missing.map((f) => FIELD_NAMES[f]).join(', ')}.
          {!USING_SEED_DATA && (account ? (
            <button type="button" className="link-btn" onClick={() => setOpen(true)}>
              Add what you know
            </button>
          ) : (
            <span className="unrecorded-cta"> Sign in to add what you know.</span>
          ))}
        </p>
      )}

      {open && (
        <div className="answer">
          <span className="claimed-label">Only answer what you can see</span>
          {missing.map((field) => (
            <div key={field} className="answer-row">
              <span className="answer-q">{FIELD_QUESTIONS[field]}</span>
              <div className="answer-options">
                {FIELD_OPTIONS[field].map(({ value, label }) => (
                  <button
                    key={value}
                    type="button"
                    className="chip"
                    disabled={busy !== null}
                    onClick={() => void send(field, value)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          ))}
          <p className="answer-note">
            {answered.size > 0
              ? `Thanks — ${answered.size} recorded. Two people have to agree before an answer shows as fact.`
              : 'Two people have to agree before an answer is shown as fact.'}
          </p>
        </div>
      )}

      {error && <p className="report-error">{error}</p>}
    </section>
  )
}
