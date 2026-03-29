// Server-only admin Supabase client
// Uses the service role key, which bypasses Row Level Security.
// Only import this in server-side code (Route Handlers, Server Actions).
// NEVER expose this to the browser.

import { createClient } from '@supabase/supabase-js'

export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !serviceKey) {
    throw new Error(
      'Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables'
    )
  }

  return createClient(url, serviceKey, {
    auth: { persistSession: false },
  })
}
