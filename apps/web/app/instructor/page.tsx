import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import LogoutButton from '@/components/LogoutButton'

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

  return (
    <div className="dashboard">
      <span className="badge instructor">Instructor</span>
      <h1>Instructor Dashboard</h1>
      <p>Logged in as {user.email}</p>

      <p>
        From here you will be able to manage your classes, students, and
        curriculum. (Coming soon.)
      </p>

      <LogoutButton />
    </div>
  )
}
