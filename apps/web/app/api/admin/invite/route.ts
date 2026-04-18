import { createClient as createServerClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

function jsonResponse(body: Record<string, unknown>, status: number) {
  return Response.json(body, { status })
}

export async function POST(request: Request) {
  try {
    // Verify the caller is an authenticated admin
    const supabase = await createServerClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return jsonResponse({ error: 'Unauthorized.' }, 401)
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()

    if (profile?.role !== 'admin') {
      return jsonResponse({ error: 'Only admins can invite instructors.' }, 403)
    }

    // Parse request body
    let email: string
    try {
      const body = (await request.json()) as { email?: unknown }
      email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
    } catch {
      return jsonResponse({ error: 'Request body must be valid JSON.' }, 400)
    }

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return jsonResponse({ error: 'A valid email address is required.' }, 400)
    }

    // Use service role key to send the invite — bypasses RLS
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!serviceRoleKey) {
      return jsonResponse({ error: 'Server misconfiguration: missing service role key.' }, 500)
    }

    const adminSupabase = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      serviceRoleKey
    )

    const { origin } = new URL(request.url)

    const { data: linkData, error: inviteError } = await adminSupabase.auth.admin.generateLink({
      type: 'invite',
      email,
      options: {
        data: {
          role: 'instructor',
          invited_by: user.id,
        },
        redirectTo: `${origin}/auth/invite-callback`,
      },
    })

    if (inviteError) {
      if (/already been registered/i.test(inviteError.message)) {
        return jsonResponse({ error: 'An account with this email already exists.' }, 409)
      }
      return jsonResponse({ error: inviteError.message }, 500)
    }

    return jsonResponse({ success: true, email, inviteLink: linkData.properties.action_link }, 200)
  } catch (error) {
    console.error('Error in POST /api/admin/invite:', error)
    return jsonResponse({ error: 'Internal server error.' }, 500)
  }
}
