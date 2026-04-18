import { createClient } from '@/lib/supabase/server'
import {
  getSessionUser,
  requireMatchingUserId,
} from '@/lib/feedback/feedback-route-auth'

function isValidUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  )
}

export type FeedbackHistoryItem = {
  id: string
  user_id: string
  lesson_plan_id: string
  original_filename: string
  status: string
  created_at: string
  storage_path: string
}

/**
 * GET /feedback/user/:userId — full feedback history for the instructor dashboard.
 * 401 if not logged in; 403 if :userId ≠ session user.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    const { userId } = await params

    if (!userId || !isValidUuid(userId)) {
      return Response.json({ error: 'Invalid userId.' }, { status: 400 })
    }

    const supabase = await createClient()
    const session = await getSessionUser(supabase)

    if (!session.ok) {
      return session.response
    }

    const forbidden = requireMatchingUserId(session.user.id, userId)
    if (forbidden) {
      return forbidden
    }

    const { data: rows, error } = await supabase
      .from('feedback')
      .select(
        'id, user_id, lesson_plan_id, original_filename, status, created_at, storage_path'
      )
      .eq('user_id', userId)
      .order('created_at', { ascending: false })

    if (error) {
      console.error('GET /feedback/user/[userId]:', error)
      return Response.json({ error: 'Failed to load feedback.' }, { status: 500 })
    }

    const items: FeedbackHistoryItem[] = (rows ?? []).map((row) => ({
      id: row.id as string,
      user_id: row.user_id as string,
      lesson_plan_id: row.lesson_plan_id as string,
      original_filename: row.original_filename as string,
      status: row.status as string,
      created_at: row.created_at as string,
      storage_path: row.storage_path as string,
    }))

    return Response.json({ items })
  } catch (error) {
    console.error('GET /feedback/user/[userId]:', error)
    return Response.json({ error: 'Internal server error.' }, { status: 500 })
  }
}
