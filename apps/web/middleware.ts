// middleware.ts — runs on every request that matches the config below.
// It refreshes the Supabase session cookie and blocks unauthenticated
// users from reaching protected pages.

import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function middleware(request: NextRequest) {
  // Start with a plain "continue" response so we can attach cookies later
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet: { name: string; value: string; options?: Record<string, unknown> }[]) {
          // Write updated cookies onto the outgoing response
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // getUser() validates the session on every request
  const {
    data: { user },
  } = await supabase.auth.getUser()

  // If there is no valid user, redirect to /login
  if (!user) {
    const loginUrl = new URL('/login', request.url)
    return NextResponse.redirect(loginUrl)
  }

  return supabaseResponse
}

// Only run this middleware on protected routes
export const config = {
  matcher: ['/dashboard/:path*', '/admin/:path*', '/instructor/:path*'],
}
