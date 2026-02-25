/**
 * Next.js middleware: protect routes that require auth.
 * TODO: Use createServerClient from @supabase/ssr to get session.
 * TODO: If request is to /dashboard, /dashboard/instructor, /dashboard/admin and no session, redirect to /login.
 * TODO: Optionally: if session and path is /login or /signup, redirect to /dashboard.
 */
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(request: NextRequest) {
  // TODO: Get session from Supabase (cookie); redirect unauthenticated users from /dashboard* to /login
  const next = NextResponse.next();
  return next;
}

export const config = {
  matcher: ["/dashboard/:path*", "/login", "/signup"],
};
