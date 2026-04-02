import { requireAdmin } from '@/lib/supabase/admin'
import { NextResponse } from 'next/server'

/** GET — instructors assigned to the logged-in admin */
export async function GET() {
  const auth = await requireAdmin()

  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const { supabase, user } = auth

  const { data, error } = await supabase
    .from('profiles')
    .select('id, email')
    .eq('assigned_admin_id', user.id)
    .eq('role', 'instructor')

  if (error) {
    return NextResponse.json(
      { error: 'Failed to fetch instructors' },
      { status: 500 }
    )
  }

  return NextResponse.json(data ?? [])
}
