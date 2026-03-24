import { redirect, notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import LogoutButton from '@/components/LogoutButton'

export default async function InstructorDetailPage({
  params,
}: {
  params: Promise<{ instructorId: string }>
}) {
  const { instructorId } = await params
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (profile?.role !== 'admin') redirect('/instructor')

  // confirm this instructor belongs to the logged-in admin
  const { data: instructor } = await supabase
    .from('profiles')
    .select('id, email')
    .eq('id', instructorId)
    .eq('assigned_admin_id', user.id)
    .single()

  if (!instructor) notFound()

  // fetch files + feedback at the same time
  const [filesRes, feedbackRes, instructorsRes] = await Promise.all([
    supabase
      .from('files')
      .select('file_id, original_name, storage_path, created_at')
      .eq('user_id', instructorId)
      .order('created_at', { ascending: false }),
    supabase
      .from('feedback')
      .select('id, created_at')
      .eq('user_id', instructorId)
      .order('created_at', { ascending: false }),
    supabase
      .from('profiles')
      .select('id, email')
      .eq('assigned_admin_id', user.id)
      .eq('role', 'instructor'),
  ])

  const rawFiles = filesRes.data ?? []

  // generate signed URLs for each file so the admin can open/download them
  const files = await Promise.all(
    rawFiles.map(async f => {
      const { data } = await supabase.storage.from('documents').createSignedUrl(f.storage_path, 3600)
      return { ...f, signedUrl: data?.signedUrl ?? null }
    })
  )
  const feedback = feedbackRes.data ?? []
  const instructors = instructorsRes.data ?? []

  return (
    <div className="instructor-shell">
      <aside className="instructor-sidebar">
        <div className="sidebar-header">
          <Link href="/admin" className="sidebar-brand">AllStarCode</Link>
        </div>

        <nav className="sidebar-nav">
          <p className="sidebar-nav-label">Instructors</p>
          {instructors.map(i => (
            <Link
              key={i.id}
              href={`/admin/instructors/${i.id}`}
              className={`sidebar-nav-item${i.id === instructorId ? ' active' : ''}`}
            >
              <span className="sidebar-nav-avatar">{i.email?.[0]?.toUpperCase() ?? '?'}</span>
              {i.email ?? i.id}
            </Link>
          ))}
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
          <p className="instructor-topbar-title">{instructor.email}</p>
          <span className="instructor-topbar-meta">{files.length} files · {feedback.length} feedback</span>
        </div>

        <div className="instructor-thread">
          {/* instructor card */}
          <div className="admin-instructor-card">
            <div className="admin-instructor-avatar">{instructor.email?.[0]?.toUpperCase() ?? '?'}</div>
            <div className="admin-file-info">
              <span className="admin-file-name">{instructor.email}</span>
              <span className="admin-file-date">instructor · {instructor.id.slice(0, 8)}…</span>
            </div>
          </div>

          {/* files */}
          <div className="admin-detail-section">
            <p className="admin-detail-label">files ({files.length})</p>
            {files.length === 0 ? (
              <p className="admin-empty">no files uploaded</p>
            ) : (
              <div className="admin-file-list">
                {files.map(f => (
                  <div key={f.file_id} className="admin-file-row">
                    <span className="file-chip-icon">PDF</span>
                    <div className="admin-file-info">
                      {f.signedUrl
                        ? <a href={f.signedUrl} target="_blank" rel="noreferrer" className="admin-file-link">{f.original_name}</a>
                        : <span className="admin-file-link" style={{ cursor: 'default' }}>{f.original_name}</span>
                      }
                      <span className="admin-file-date">{new Date(f.created_at).toLocaleDateString()}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* feedback — view opens the PDF route built by SWE 4 */}
          <div className="admin-detail-section">
            <p className="admin-detail-label">feedback ({feedback.length})</p>
            {feedback.length === 0 ? (
              <p className="admin-empty">no feedback generated yet</p>
            ) : (
              <div className="admin-file-list">
                {feedback.map(fb => (
                  <div key={fb.id} className="admin-file-row">
                    <div className="admin-file-info">
                      <span className="admin-file-name">feedback · {fb.id.slice(0, 8)}…</span>
                      <span className="admin-file-date">{new Date(fb.created_at).toLocaleDateString()}</span>
                    </div>
                    <a
                      href={`/feedback/${fb.id}`}
                      target="_blank"
                      rel="noreferrer"
                      className="msg-action-btn"
                    >
                      view
                    </a>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
