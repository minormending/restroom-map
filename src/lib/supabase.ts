import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { SUPABASE_ANON_KEY, SUPABASE_URL, USING_SEED_DATA } from './config'

/**
 * Null until a project is configured. The anon key is meant to be public — it
 * identifies the project and authorises nothing. Every rule lives in RLS.
 */
export const supabase: SupabaseClient | null = USING_SEED_DATA
  ? null
  : createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false }, // no accounts until M2
    })
