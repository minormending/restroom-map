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

/**
 * The same connection, addressed at the shared `public` layer.
 *
 * Not a second client — no extra session, no extra socket. `.schema()` returns
 * a view of this one that sets a different profile header on the request.
 *
 * It exists because PostgREST resolves **strictly** inside the schema a request
 * names, with no fallback: the client above says `restroom`, so a call to a
 * shared function through it asks for `restroom.submit_feedback` and gets a
 * PGRST202. Anything living in the shared layer — `submit_flag`,
 * `submit_feedback`, `profiles` — has to be reached through this handle
 * instead, and the name at the call site is the only thing that says which
 * layer is being talked to.
 */
export const shared = supabase?.schema('public') ?? null

export type SharedClient = NonNullable<typeof shared>
