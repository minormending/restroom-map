import { createClient } from '@supabase/supabase-js'
import { SUPABASE_ANON_KEY, SUPABASE_URL, USING_SEED_DATA } from './config'

/**
 * Null until a project is configured. The anon key is meant to be public — it
 * identifies the project and authorises nothing. Every rule lives in RLS.
 */
function connect() {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true, // OAuth returns here with tokens in the URL
    },
    // This app's tables live in `restroom`. The database is shared with
    // other apps, each in its own schema, over one `public` layer holding
    // profiles, rate limiting and the moderation queue.
    db: { schema: 'restroom' },
  })
}

/**
 * Inferred rather than annotated: the client's type carries its schema, so a
 * bare `SupabaseClient` is the public-schema one and no longer describes this.
 */
export type RestroomClient = ReturnType<typeof connect>

export const supabase: RestroomClient | null = USING_SEED_DATA ? null : connect()
