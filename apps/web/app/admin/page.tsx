import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import LogoutButton from '@/components/LogoutButton'

export default async function AdminPage() {
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

  if (profile?.role !== 'admin') redirect('/instructor')

  return (
    <div className="dashboard">
      <span className="badge admin">Admin</span>
      <h1>Admin Dashboard</h1>
      <p>Logged in as {user.email}</p>

      <p>
        From here you will be able to manage instructors, review content, and
        configure the platform. (Coming soon.)
      </p>

      <LogoutButton />
    </div>
  )
}
