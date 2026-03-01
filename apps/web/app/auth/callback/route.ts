// Handles the redirect that Supabase sends after email confirmation.
// If you disable email confirmation in the Supabase dashboard this
// route will not normally be hit, but it's good to have it ready.

import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const next = searchParams.get('next') ?? '/dashboard'

  if (code) {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`)
    }
  }

  // Something went wrong — send them back to login with an error flag
  return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`)
}
