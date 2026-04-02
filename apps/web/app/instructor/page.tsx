import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import InstructorWorkspace from '@/components/instructor/InstructorWorkspace'

export default async function InstructorPage() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (profile?.role === 'admin') redirect('/admin')

  return <InstructorWorkspace userId={user.id} userEmail={user.email} />
}
