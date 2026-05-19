import { createClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

type RouteContext = {
  params: Promise<{ sessionId: string }>
}

function jsonResponse(body: Record<string, unknown>, status: number) {
  return Response.json(body, { status })
}

function isValidUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

export async function GET(_request: Request, context: RouteContext) {
  const { sessionId } = await context.params

  if (!isValidUuid(sessionId)) {
    return jsonResponse({ success: false, error: 'Invalid session ID.' }, 400)
  }

  const supabase = await createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    return jsonResponse({ success: false, error: 'Unauthorized.' }, 401)
  }

  const { data: session, error: sessionError } = await supabase
    .from('chat_sessions')
    .select('id')
    .eq('id', sessionId)
    .eq('user_id', user.id)
    .maybeSingle()

  if (sessionError) {
    return jsonResponse({ success: false, error: 'Failed to load session.' }, 500)
  }

  if (!session) {
    return jsonResponse({ success: false, error: 'Session not found.' }, 404)
  }

  const { data: messages, error: messagesError } = await supabase
    .from('chat_messages')
    .select('id, role, content, created_at')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: true })

  if (messagesError) {
    return jsonResponse({ success: false, error: 'Failed to load messages.' }, 500)
  }

  return jsonResponse({ success: true, messages: messages ?? [] }, 200)
}
