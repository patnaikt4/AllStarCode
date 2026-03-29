// GET /feedback/[feedback_id]
//
// Returns the generated feedback PDF for the given feedback record.
// The caller must be the instructor who owns the feedback (or an admin).
//
// Response: application/pdf stream on success, JSON error on failure.

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { FEEDBACK_BUCKET } from '@/lib/storage/constants'

// ─── Response helpers ─────────────────────────────────────────────────────────

function errorResponse(status: number, code: string, message: string): NextResponse {
  return NextResponse.json({ success: false, error: { code, message } }, { status })
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ feedback_id: string }> }
): Promise<NextResponse> {
  const { feedback_id: feedbackId } = await params

  // ── 1. Authenticate ──────────────────────────────────────────────────────
  const sessionClient = await createClient()

  const {
    data: { user },
    error: authError,
  } = await sessionClient.auth.getUser()

  if (authError || !user) {
    return errorResponse(401, 'UNAUTHORIZED', 'You must be logged in to access feedback')
  }

  // ── 2. Fetch feedback row ────────────────────────────────────────────────
  const adminClient = createAdminClient()

  const { data: row, error: dbError } = await adminClient
    .from('feedback')
    .select('id, instructor_id, lesson_plan_id, storage_path, status, error_message')
    .eq('id', feedbackId)
    .single()

  if (dbError || !row) {
    if (dbError?.code === 'PGRST116') {
      return errorResponse(404, 'NOT_FOUND', 'Feedback record not found')
    }
    return errorResponse(500, 'DB_ERROR', 'Failed to retrieve feedback record')
  }

  // ── 3. Authorisation: user must own the feedback or be an admin ──────────
  if (row.instructor_id !== user.id) {
    const { data: profile } = await sessionClient
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()

    if (profile?.role !== 'admin') {
      return errorResponse(403, 'FORBIDDEN', 'You do not have access to this feedback')
    }
  }

  // ── 4. Check status ──────────────────────────────────────────────────────
  if (row.status === 'processing') {
    return errorResponse(
      202,
      'FEEDBACK_PROCESSING',
      'Feedback is still being generated — please try again in a moment'
    )
  }

  if (row.status === 'failed') {
    return errorResponse(
      422,
      'FEEDBACK_FAILED',
      row.error_message ?? 'Feedback generation failed — please regenerate'
    )
  }

  if (!row.storage_path) {
    return errorResponse(404, 'NOT_FOUND', 'Feedback PDF has not been stored yet')
  }

  // ── 5. Download PDF from Supabase Storage ────────────────────────────────
  const { data: blob, error: storageError } = await adminClient.storage
    .from(FEEDBACK_BUCKET)
    .download(row.storage_path)

  if (storageError || !blob) {
    console.error(
      `[feedback/${feedbackId}] storage download failed:`,
      storageError?.message
    )
    return errorResponse(
      502,
      'STORAGE_ERROR',
      'Failed to retrieve feedback PDF — please try again'
    )
  }

  // ── 6. Return PDF ────────────────────────────────────────────────────────
  const arrayBuffer = await blob.arrayBuffer()

  return new NextResponse(arrayBuffer, {
    status: 200,
    headers: {
      'Content-Type':        'application/pdf',
      'Content-Disposition': `inline; filename="feedback-${feedbackId}.pdf"`,
      'Cache-Control':       'private, max-age=300',
    },
  })
}
