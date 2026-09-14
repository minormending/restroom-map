import { useState } from 'react'
import { rememberReport, reportedKind } from './reported'
import { submitReport, type ReportResult } from './reports'
import type { Bathroom, ReportKind } from './types'

/**
 * Filing a report, minus the buttons.
 *
 * Two surfaces ask the same question now — the detail sheet, and the prompt
 * that appears when you are standing at a place — and they ask it in different
 * shapes. What they must not do is differ in what happens on a tap: the local
 * memory, the already-reported case and the optimistic patch back into the map
 * are the parts that go quietly wrong when there are two copies of them.
 */
export function useReport(
  bathroom: Bathroom,
  near: [number, number] | null,
  onReported: (id: string, patch: Partial<Bathroom>) => void,
) {
  const [done, setDone] = useState<ReportKind | null>(() => reportedKind(bathroom.id))
  // Distinguishes "we recorded that" from "you'd already told us", which are
  // different facts and shouldn't share a message.
  const [duplicate, setDuplicate] = useState(false)
  const [busy, setBusy] = useState<ReportKind | null>(null)
  const [error, setError] = useState<string | null>(null)

  const send = async (kind: ReportKind) => {
    setBusy(kind)
    setError(null)
    try {
      const res: ReportResult = await submitReport(bathroom.id, kind, near)
      rememberReport(bathroom.id, kind)
      setDone(kind)
      if (res.ok) {
        onReported(bathroom.id, {
          confirms: res.confirms ?? bathroom.confirms,
          troubles: res.troubles ?? bathroom.troubles,
          last_confirmed: res.last_confirmed ?? bathroom.last_confirmed,
        })
      } else {
        setDuplicate(res.reason === 'already_reported')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save that report.")
    } finally {
      setBusy(null)
    }
  }

  /** What a place can usefully be reported as. A wrong code is only a thing
   *  that can happen somewhere there is a code. */
  const options: ReportKind[] = bathroom.access_kind === 'code_required'
    ? ['works', 'code_bad', 'gone']
    : ['works', 'gone']

  return { done, duplicate, busy, error, options, send }
}

export const REPORT_LABELS: Record<string, string> = {
  works: 'Worked',
  code_bad: 'Code was wrong',
  gone: "Wasn't there",
}
