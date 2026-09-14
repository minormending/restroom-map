import { supabase } from './supabase'

export interface ClaimResult {
  ok: boolean
  reason?: 'already_settled'
  settled?: boolean
}

/** SQLSTATEs submit_access_claim raises deliberately. */
const MESSAGES: Record<string, string> = {
  '42501': 'Sign in to add accessibility detail.',
  '53400': "That's a lot of detail at once — try again later.",
  '22023': "That isn't an answer that field can take.",
  'P0002': 'That place is no longer on the map.',
}

export async function submitAccessClaim(
  bathroomId: string,
  field: string,
  value: string,
): Promise<ClaimResult> {
  if (!supabase) throw new Error('Adding detail needs a database connection.')

  const { data, error } = await supabase.rpc('submit_access_claim', {
    p_bathroom_id: bathroomId,
    p_field: field,
    p_value: value,
  })

  if (error) throw new Error(MESSAGES[error.code ?? ''] ?? "Couldn't save that.")
  return data as ClaimResult
}
