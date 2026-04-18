import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import LogoutButton from '@/components/LogoutButton'
import AdminSelfService from '@/components/AdminSelfService'
import InviteInstructor from '@/components/InviteInstructor'

export default async function AdminPage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (profile?.role !== 'admin') redirect('/instructor')

  // fetch instructors assigned to this admin
  const { data: instructors } = await supabase
    .from('profiles')
    .select('id, email')
    .eq('assigned_admin_id', user.id)
    .eq('role', 'instructor')

  return (
    <div className="instructor-shell">
      <aside className="instructor-sidebar">
        <div className="sidebar-header">
          <p className="sidebar-brand">AllStarCode</p>
        </div>

        <nav className="sidebar-nav">
          <p className="sidebar-nav-label">Instructors</p>
          {!instructors?.length ? (
            <p className="sidebar-nav-empty">no instructors assigned</p>
          ) : (
            instructors.map(i => (
              <Link key={i.id} href={`/admin/instructors/${i.id}`} className="sidebar-nav-item">
                <span className="sidebar-nav-avatar">{i.email?.[0]?.toUpperCase() ?? '?'}</span>
                {i.email ?? i.id}
              </Link>
            ))
          )}
        </nav>

        <div className="sidebar-footer">
          <div className="sidebar-user-info">
            <span className="badge admin">Admin</span>
            <span className="sidebar-user-email">{user.email}</span>
          </div>
          <LogoutButton />
        </div>
      </aside>

      <div className="instructor-main">
        <div className="instructor-topbar">
          <p className="instructor-topbar-title">Admin</p>
        </div>
        <div style={{ padding: '1.5rem' }}>
          <InviteInstructor />
          <AdminSelfService />
        </div>
      </div>
    </div>
  )
}
