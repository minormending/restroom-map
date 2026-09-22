import { shared, supabase } from './supabase'
import type { AccessKind, ChangingTableAccess, VenueType, WheelchairAccess } from './types'

export interface NewPlace {
  name: string
  lat: number
  lng: number
  venue_type: VenueType
  access_kind: AccessKind
  address?: string
  floor_hint?: string
  code?: string
  wheelchair?: WheelchairAccess | null
  changing_table?: ChangingTableAccess | null
  gender_neutral?: boolean | null
}

export type SubmitResult =
  | { ok: true; id: string }
  | { ok: false; reason: 'duplicate'; existing_id: string; existing_name: string }

function fail(message: string, code?: string): never {
  const friendly: Record<string, string> = {
    '42501': 'Sign in first.',
    '53400': "That's enough submissions for one day.",
    '22023': message,
    'P0002': 'That place is no longer on the map.',
  }
  throw new Error((code && friendly[code]) || message)
}

export async function submitBathroom(place: NewPlace): Promise<SubmitResult> {
  if (!supabase) throw new Error('Adding a place needs a database connection.')

  const { data, error } = await supabase.rpc('submit_bathroom', {
    p_name: place.name,
    p_lat: place.lat,
    p_lng: place.lng,
    p_venue_type: place.venue_type,
    p_access_kind: place.access_kind,
    p_address: place.address ?? null,
    p_floor_hint: place.floor_hint ?? null,
    p_code: place.code ?? null,
    p_wheelchair: place.wheelchair ?? null,
    p_changing_table: place.changing_table ?? null,
    p_gender_neutral: place.gender_neutral ?? null,
  })

  if (error) fail(error.message, error.code)
  return data as SubmitResult
}

/** Supersedes the current code rather than overwriting it. */
export async function submitCode(
  bathroomId: string,
  code: string,
): Promise<{ ok: boolean; changed: boolean }> {
  if (!supabase) throw new Error('Adding a code needs a database connection.')

  const { data, error } = await supabase.rpc('submit_code', {
    p_bathroom_id: bathroomId,
    p_code: code,
  })

  if (error) fail(error.message, error.code)
  return data as { ok: boolean; changed: boolean }
}

export interface Comment {
  id: string
  body: string
  created_at: string
  author: string
}

/**
 * Display names for a set of accounts, as a lookup.
 *
 * Its own query because `profiles` is in the shared `public` layer and
 * `comments` is in `restroom`, and **PostgREST will not embed across
 * schemas** — asking for `profiles(display_name)` from a request naming
 * `restroom` answers PGRST200, "no relationship found", however real the
 * foreign key is. One batched `in` rather than a lookup per row.
 *
 * A failure here returns an empty map rather than throwing. The note is the
 * thing somebody came to read; the name above it is furniture, and losing the
 * whole page of notes because the names could not be fetched is the wrong
 * trade.
 */
async function displayNames(ids: string[]): Promise<Map<string, string>> {
  const wanted = [...new Set(ids.filter(Boolean))]
  if (!shared || wanted.length === 0) return new Map()

  const { data, error } = await shared
    .from('profiles')
    .select('id, display_name')
    .in('id', wanted)

  if (error) return new Map()
  return new Map((data ?? []).map((row) => [row.id as string, row.display_name as string]))
}

export async function fetchComments(bathroomId: string): Promise<Comment[]> {
  if (!supabase) return []
  const { data, error } = await supabase
    .from('comments')
    .select('id, body, created_at, user_id')
    .eq('bathroom_id', bathroomId)
    .order('created_at', { ascending: false })
    .limit(50)

  if (error) throw new Error(error.message)

  const rows = data ?? []
  const names = await displayNames(rows.map((row) => row.user_id as string))
  return rows.map((row) => ({
    id: row.id as string,
    body: row.body as string,
    created_at: row.created_at as string,
    author: names.get(row.user_id as string) ?? 'Someone',
  }))
}

export async function addComment(
  bathroomId: string,
  userId: string,
  body: string,
): Promise<void> {
  if (!supabase) throw new Error('Commenting needs a database connection.')
  const { error } = await supabase
    .from('comments')
    .insert({ bathroom_id: bathroomId, user_id: userId, body })
  if (error) throw new Error(error.message)
}
