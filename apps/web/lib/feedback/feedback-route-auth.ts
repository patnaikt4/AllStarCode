import type { User } from '@supabase/supabase-js'

import { createClient } from '@/lib/supabase/server'

type SupabaseServer = Awaited<ReturnType<typeof createClient>>

export type SessionResult =
  | { ok: true; user: User; supabase: SupabaseServer }
  | { ok: false; response: Response }

/**
 * Authenticated Supabase client + user for feedback routes.
 * Returns 401 JSON when there is no session.
 */
export async function getSessionUser(
  supabase: SupabaseServer
): Promise<SessionResult> {
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()

  if (error || !user) {
    return {
      ok: false,
      response: Response.json({ error: 'Unauthorized.' }, { status: 401 }),
    }
  }

  return { ok: true, user, supabase }
}

/**
 * List route: only the logged-in user may fetch `/feedback/user/:userId`.
 */
export function requireMatchingUserId(
  sessionUserId: string,
  paramUserId: string
): Response | null {
  if (sessionUserId !== paramUserId) {
    return Response.json({ error: 'Forbidden.' }, { status: 403 })
  }
  return null
}

/**
 * PDF route: row was loaded with the user-scoped client. Enforce owner or admin
 * in code so access rules stay explicit even if RLS misconfiguration slips in.
 * Returns null if access is allowed.
 */
export async function assertFeedbackRowAccess(
  supabase: SupabaseServer,
  sessionUserId: string,
  rowUserId: string
): Promise<Response | null> {
  if (sessionUserId === rowUserId) {
    return null
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', sessionUserId)
    .maybeSingle()

  if (profile?.role === 'admin') {
    return null
  }

  return new Response('Feedback not found', { status: 404 })
}
