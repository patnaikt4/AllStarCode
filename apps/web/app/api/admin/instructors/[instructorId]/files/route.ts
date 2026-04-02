import { requireAdmin } from '@/lib/supabase/admin'
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

/** GET — files for an instructor assigned to this admin */
export async function GET(_request: Request, context: RouteContext) {
  const auth = await requireAdmin()

  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const { instructorId } = await context.params
  const { supabase, user } = auth

  if (!isValidUuid(instructorId)) {
    return NextResponse.json({ error: 'Invalid instructor id' }, { status: 400 })
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

  const { data: fileRows, error: filesError } = await supabase
    .from('files')
    .select('file_id, original_name, storage_path, content_type, created_at')
    .eq('user_id', instructorId)
    .order('created_at', { ascending: false })

  if (filesError) {
    return NextResponse.json({ error: 'Failed to fetch files' }, { status: 500 })
  }

  return NextResponse.json(fileRows ?? [])
}
