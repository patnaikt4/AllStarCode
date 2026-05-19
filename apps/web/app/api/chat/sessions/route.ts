import { createClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

function jsonResponse(body: Record<string, unknown>, status: number) {
  return Response.json(body, { status })
}

export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    return jsonResponse({ success: false, error: 'Unauthorized.' }, 401)
  }

  const { data: sessions, error } = await supabase
    .from('chat_sessions')
    .select('id, title, created_at, updated_at')
    .eq('user_id', user.id)
    .order('updated_at', { ascending: false })
    .limit(50)

  if (error) {
    return jsonResponse({ success: false, error: 'Failed to load sessions.' }, 500)
  }

  return jsonResponse({ success: true, sessions: sessions ?? [] }, 200)
}
