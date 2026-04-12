import { requireAdmin } from '@/lib/supabase/admin'
import { NextResponse } from 'next/server'

type RouteContext = {
  params: Promise<{
    instructorId: string
  }>
}

/**
 * Admin-only JSON list of an instructor's feedback (for tooling / parity with dashboard).
 */
export async function GET(_request: Request, context: RouteContext) {
  const { instructorId } = await context.params

  const auth = await requireAdmin()

  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const { supabase } = auth

  const { data: instructor, error: instructorError } = await supabase
    .from('profiles')
    .select('id')
    .eq('id', instructorId)
    .eq('role', 'instructor')
    .maybeSingle()

  if (instructorError) {
    return NextResponse.json(
      { error: 'Failed to validate instructor' },
      { status: 500 }
    )
  }

  if (!instructor) {
    return NextResponse.json({ error: 'Instructor not found' }, { status: 404 })
  }

  const { data: feedbackRows, error: feedbackError } = await supabase
    .from('feedback')
    .select(
      'id, user_id, lesson_plan_id, original_filename, status, source_type, created_at, storage_path, feedback_text'
    )
    .eq('user_id', instructorId)
    .order('created_at', { ascending: false })

  if (feedbackError) {
    return NextResponse.json(
      { error: 'Failed to fetch feedback' },
      { status: 500 }
    )
  }

  return NextResponse.json({ items: feedbackRows ?? [] })
}
