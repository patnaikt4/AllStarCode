import { createClient } from '@/lib/supabase/server'
import {
  assertFeedbackRowAccess,
  getSessionUser,
} from '@/lib/feedback/feedback-route-auth'
import { getFeedbackStorageBucket } from '@/lib/feedback/feedback-storage-bucket'

function isValidUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  )
}

function sanitizeFilename(name: string) {
  const trimmed = name.trim() || 'feedback.pdf'
  return trimmed.replace(/[\r\n"]/g, '_')
}

/**
 * GET /feedback/:feedbackId — PDF bytes. Metadata is also exposed via headers.
 * 401 if not logged in. 404 if the row is missing or RLS hides it (no enumeration).
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ feedback_id: string }> }
) {
  try {
    const { feedback_id } = await params

    if (!feedback_id || !isValidUuid(feedback_id)) {
      return new Response('Invalid feedback_id', { status: 400 })
    }

    const supabase = await createClient()
    const session = await getSessionUser(supabase)

    if (!session.ok) {
      return session.response
    }

    const { data: row, error: dbError } = await supabase
      .from('feedback')
      .select(
        'storage_path, user_id, original_filename, status, created_at, lesson_plan_id'
      )
      .eq('id', feedback_id)
      .single()

    if (dbError || !row) {
      return new Response('Feedback not found', { status: 404 })
    }

    const denied = await assertFeedbackRowAccess(
      supabase,
      session.user.id,
      row.user_id as string
    )
    if (denied) {
      return denied
    }

    if (!row.storage_path) {
      return new Response('Feedback PDF path not found', { status: 404 })
    }

    const { data: fileData, error: storageError } = await supabase.storage
      .from(getFeedbackStorageBucket())
      .download(row.storage_path as string)

    if (storageError || !fileData) {
      return new Response('Feedback PDF not found', { status: 404 })
    }

    const arrayBuffer = await fileData.arrayBuffer()
    const filename = sanitizeFilename(String(row.original_filename ?? 'feedback.pdf'))
    const createdAt = String(row.created_at ?? '')
    const status = String(row.status ?? '')
    const lessonPlanId = String(row.lesson_plan_id ?? '')

    return new Response(arrayBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${filename}"`,
        'X-Feedback-Id': feedback_id,
        'X-Feedback-Status': status,
        'X-Feedback-Created-At': createdAt,
        'X-Lesson-Plan-Id': lessonPlanId,
        'X-Original-Filename': filename,
      },
    })
  } catch (error) {
    console.error('Error in GET /feedback/[feedback_id]:', error)
    return new Response('Internal server error', { status: 500 })
  }
}
