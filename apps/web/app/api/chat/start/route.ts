import { createClient } from '@/lib/supabase/server'
import { getSessionUser } from '@/lib/feedback/feedback-route-auth'

/**
 * POST /api/chat/start
 * Creates a new empty chat session for the logged-in user.
 */
export async function POST() {
  try {
    const supabase = await createClient()
    const session = await getSessionUser(supabase)

    if (!session.ok) {
      return session.response
    }

    const { data, error } = await supabase
      .from('chat_sessions')
      .insert({
        user_id: session.user.id,
        title: 'New chat',
      })
      .select('id')
      .single()

    if (error) {
      console.error('POST /api/chat/start:', error)
      return Response.json(
        { error: 'Failed to create chat session.' },
        { status: 500 }
      )
    }

    return Response.json(
      { sessionId: data.id as string },
      { status: 201 }
    )
  } catch (error) {
    console.error('POST /api/chat/start:', error)
    return Response.json({ error: 'Internal server error.' }, { status: 500 })
  }
}