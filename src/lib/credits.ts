import { supabase } from './supabase'

export interface LedgerEntry {
  id: string
  delta: number
  reason: string
  created_at: string
}

/** Balance is the sum of the ledger, never a stored number. */
export async function fetchBalance(): Promise<number> {
  if (!supabase) return 0
  const { data, error } = await supabase.from('user_credits').select('balance').maybeSingle()
  if (error) throw new Error(error.message)
  return (data?.balance as number) ?? 0
}

export async function fetchLedger(): Promise<LedgerEntry[]> {
  if (!supabase) return []
  const { data, error } = await supabase
    .from('credit_ledger')
    .select('id, delta, reason, created_at')
    .order('created_at', { ascending: false })
    .limit(50)
  if (error) throw new Error(error.message)
  return (data ?? []) as LedgerEntry[]
}

/** Written from the reader's side of the screen, not the schema's. */
export const REASON_LABELS: Record<string, string> = {
  signup_bonus: 'Welcome',
  submission_verified: 'A place you added was confirmed',
  code_verified: 'A code you added was confirmed',
  passive_confirmation: 'Someone confirmed your code',
  fraud_clawback: 'A place you added was removed',
  spend_unlock: 'Unlocked a code',
  manual_adjustment: 'Adjustment',
}
