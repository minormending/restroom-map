import { supabase } from './supabase'
import type { ReportKind } from './types'

export interface ReportResult {
  ok: boolean
  reason?: 'already_reported'
  geo_verified?: boolean
  confirms?: number
  troubles?: number
  last_confirmed?: string | null
}

/** Postgres SQLSTATEs the RPC raises deliberately, mapped to plain English. */
const MESSAGES: Record<string, string> = {
  '53400': "That's a lot of reports from here — try again later.",
  '42501': "You can't report your own submission.",
  'P0002': 'That place is no longer on the map.',
}

function explain(code: string | undefined, fallback: string): string {
  return (code && MESSAGES[code]) || fallback
}

/**
 * Coordinates are sent so the server can check you're actually near the place,
 * but it stores only the resulting boolean and discards them.
 */
export async function submitReport(
  bathroomId: string,
  kind: ReportKind,
  near: [number, number] | null,
): Promise<ReportResult> {
  if (!supabase) throw new Error('Reporting needs a database connection.')

  const { data, error } = await supabase.rpc('submit_report', {
    p_bathroom_id: bathroomId,
    p_kind: kind,
    p_lng: near?.[0] ?? null,
    p_lat: near?.[1] ?? null,
  })

  if (error) throw new Error(explain(error.code, "Couldn't save that report."))
  return data as ReportResult
}

export async function submitFlag(
  targetId: string,
  reason: string,
  contactEmail?: string,
): Promise<void> {
  if (!supabase) throw new Error('Reporting needs a database connection.')

  // Shared with every app in the database, hence p_app. The parameter is
  // p_message rather than p_reason: this app predates map-kit, and the column
  // was renamed when the kit was extracted from it.
  const { error } = await supabase.rpc('submit_flag', {
    p_app: 'restroom-map',
    p_target_type: 'bathroom',
    p_target_id: targetId,
    p_message: reason,
    p_contact_email: contactEmail ?? null,
  })

  if (error) throw new Error(explain(error.code, "Couldn't send that."))
}
