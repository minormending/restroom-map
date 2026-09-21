import { buildLabel } from './build'
import { supabase } from './supabase'

export const FEEDBACK_KINDS = ['bug', 'idea', 'complaint'] as const
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number]

/** What each one is, in the words somebody arriving would use. */
export const FEEDBACK_LABELS: Record<FeedbackKind, string> = {
  bug: 'Something is broken',
  idea: 'I want something',
  complaint: 'Something is wrong here',
}

export interface Feedback {
  kind: FeedbackKind
  message: string
  email?: string
}

/**
 * Send it. No account needed, on purpose — see migration 022. The build id
 * rides along because the version indicator exists to be read out when
 * something looks wrong, and this saves asking.
 */
export async function sendFeedback({ kind, message, email }: Feedback): Promise<void> {
  if (!supabase) throw new Error('Sending feedback needs a database connection.')

  // submit_feedback lives in `public` and serves every app in the database, so
  // it needs to be told which one is calling.
  const { error } = await supabase.rpc('submit_feedback', {
    p_app: 'restroom-map',
    p_kind: kind,
    p_message: message,
    p_contact_email: email?.trim() || null,
    p_build: buildLabel(),
  })

  if (error) throw new Error(error.message)
}
