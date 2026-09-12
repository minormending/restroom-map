import type { Session } from '@supabase/supabase-js'
import { SUPABASE_ANON_KEY, SUPABASE_URL } from './config'
import { supabase } from './supabase'

export interface Account {
  id: string
  name: string
  avatar: string | null
}

function toAccount(session: Session | null): Account | null {
  if (!session?.user) return null
  const meta = session.user.user_metadata ?? {}
  return {
    id: session.user.id,
    // Matches the display_name the signup trigger derives, so the name you see
    // in the UI is the name attached to your submissions.
    name: meta.full_name || meta.name || session.user.email?.split('@')[0] || 'You',
    avatar: meta.avatar_url ?? meta.picture ?? null,
  }
}

export async function currentAccount(): Promise<Account | null> {
  if (!supabase) return null
  const { data } = await supabase.auth.getSession()
  return toAccount(data.session)
}

export function onAccountChange(fn: (account: Account | null) => void): () => void {
  if (!supabase) return () => {}
  const { data } = supabase.auth.onAuthStateChange((_event, session) => {
    fn(toAccount(session))
  })
  return () => data.subscription.unsubscribe()
}

let providerCheck: Promise<boolean> | null = null

/**
 * signInWithOAuth navigates the browser before any error can be caught, and a
 * provider that isn't enabled answers with a bare JSON error page the user
 * can't get back from. Ask first: /auth/v1/settings is public and reports
 * exactly which providers are configured.
 */
function googleEnabled(): Promise<boolean> {
  providerCheck ??= fetch(`${SUPABASE_URL}/auth/v1/settings`, {
    headers: { apikey: SUPABASE_ANON_KEY },
  })
    .then((r) => (r.ok ? r.json() : null))
    .then((body) => Boolean(body?.external?.google))
    // A failed check shouldn't block sign-in; let the redirect decide.
    .catch(() => true)
  return providerCheck
}

export async function signInWithGoogle(): Promise<void> {
  if (!supabase) throw new Error('Signing in needs a database connection.')

  if (!(await googleEnabled())) {
    throw new Error("Google sign-in isn't switched on for this project yet.")
  }

  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    // Come back to the page they were on, base path and all.
    options: { redirectTo: window.location.origin + window.location.pathname },
  })
  if (error) throw new Error(error.message)
}

export async function signOut(): Promise<void> {
  await supabase?.auth.signOut()
}
