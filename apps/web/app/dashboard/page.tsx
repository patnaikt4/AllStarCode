// Dashboard page — acts as a router.
// Looks up the user's role and immediately redirects to the right dashboard.
// The middleware already guarantees that only logged-in users reach here.

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export default async function DashboardPage() {
  const supabase = await createClient()

  // Get the currently logged-in user
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  // Fetch the role from the profiles table
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (profile?.role === 'admin') {
    redirect('/admin')
  }

  // Default to instructor dashboard
  redirect('/instructor')
}
