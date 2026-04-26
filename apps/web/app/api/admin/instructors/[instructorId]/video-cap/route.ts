/**
 * Future admin UI wiring example:
 * `fetch('/api/admin/instructors/<instructorId>/video-cap', {
 *   method: 'PATCH',
 *   headers: { 'Content-Type': 'application/json' },
 *   body: JSON.stringify({ maxVideoDurationSeconds: 900 }),
 * })`
 *
 * Send `null` to clear the instructor-specific cap.
 */
import { requireAdmin } from '@/lib/supabase/admin'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

type RouteContext = {
  params: Promise<{
    instructorId: string
  }>
}

function isValidUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    v
  )
}

function parseMaxVideoDurationSeconds(value: unknown) {
  if (value === null) return { ok: true as const, value: null }

  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    return { ok: false as const }
  }

  return { ok: true as const, value }
}

/** PATCH — set or clear an assigned instructor's max video upload duration. */
export async function PATCH(request: Request, context: RouteContext) {
  try {
    const auth = await requireAdmin()

    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    const { instructorId } = await context.params
    const { supabase, user } = auth

    if (!isValidUuid(instructorId)) {
      return NextResponse.json({ error: 'Invalid instructor id' }, { status: 400 })
    }

    let maxVideoDurationSeconds: number | null

    try {
      const body = (await request.json()) as {
        maxVideoDurationSeconds?: unknown
      }

      const parsed = parseMaxVideoDurationSeconds(
        body.maxVideoDurationSeconds ?? null
      )

      if (!parsed.ok) {
        return NextResponse.json(
          {
            error:
              'maxVideoDurationSeconds must be a positive integer or null.',
          },
          { status: 400 }
        )
      }

      maxVideoDurationSeconds = parsed.value
    } catch {
      return NextResponse.json(
        { error: 'Request body must be valid JSON.' },
        { status: 400 }
      )
    }

    const { data: instructor, error: instructorError } = await supabase
      .from('profiles')
      .select('id')
      .eq('id', instructorId)
      .eq('assigned_admin_id', user.id)
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

    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!serviceRoleKey) {
      return NextResponse.json(
        { error: 'Server misconfiguration: missing service role key.' },
        { status: 500 }
      )
    }

    const adminSupabase = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      serviceRoleKey
    )

    const { data: updatedProfile, error: updateError } = await adminSupabase
      .from('profiles')
      .update({
        max_video_duration_seconds: maxVideoDurationSeconds,
      })
      .eq('id', instructorId)
      .select('id, max_video_duration_seconds')
      .single()

    if (updateError) {
      return NextResponse.json(
        { error: 'Failed to update video duration cap' },
        { status: 500 }
      )
    }

    return NextResponse.json(updatedProfile)
  } catch (error) {
    console.error(
      'Error in PATCH /api/admin/instructors/[instructorId]/video-cap:',
      error
    )
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 })
  }
}
