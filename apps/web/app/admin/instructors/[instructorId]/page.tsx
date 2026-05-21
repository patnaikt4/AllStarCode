import { redirect, notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import LogoutButton from '@/components/LogoutButton'
import VideoDurationCap from '@/components/VideoDurationCap'

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
    .select('id, email, max_video_duration_seconds')
    .eq('id', instructorId)
    .eq('assigned_admin_id', user.id)
    .single()

  if (!instructor) notFound()

  // fetch files + feedback at the same time
  const [filesRes, feedbackRes, instructorsRes] = await Promise.all([
    supabase
      .from('files')
      .select('file_id, original_name, storage_path, content_type, created_at')
      .eq('user_id', instructorId)
      .order('created_at', { ascending: false }),
    supabase
      .from('feedback')
      .select('id, original_filename, feedback_text, lesson_plan_id, created_at')
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
  const allFiles = await Promise.all(
    rawFiles.map(async f => {
      const isVideo = (f.content_type ?? '').startsWith('video/')
      const bucket = isVideo ? 'videos' : 'documents'
      const { data } = await supabase.storage.from(bucket).createSignedUrl(f.storage_path, 3600)
      return { ...f, signedUrl: data?.signedUrl ?? null, isVideo }
    })
  )

  const pdfFiles = allFiles.filter(f => !f.isVideo)
  const videoFiles = allFiles.filter(f => f.isVideo)

  const rawFeedback = feedbackRes.data ?? []

  // generate signed URLs for original lesson plan PDFs
  const feedback = await Promise.all(
    rawFeedback.map(async fb => {
      let lessonPlanUrl: string | null = null
      if (fb.lesson_plan_id) {
        const path = `${instructorId}/${fb.lesson_plan_id}.pdf`
        const { data } = await supabase.storage.from('lesson-plans').createSignedUrl(path, 3600)
        lessonPlanUrl = data?.signedUrl ?? null
      }
      return { ...fb, lessonPlanUrl }
    })
  )

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
          <span className="instructor-topbar-meta">{pdfFiles.length} PDFs · {videoFiles.length} videos · {feedback.length} feedback</span>
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

          {/* Lesson PDFs */}
          <div className="admin-detail-section">
            <p className="admin-detail-label">Lesson PDFs ({pdfFiles.length})</p>
            {pdfFiles.length === 0 ? (
              <p className="admin-empty">no PDFs uploaded</p>
            ) : (
              <div className="admin-file-list">
                {pdfFiles.map(f => (
                  <div key={f.file_id} className="admin-file-row">
                    <span className="file-chip-icon" style={{ background: '#e8f4fd', color: '#0070f3' }}>PDF</span>
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

          {/* Videos */}
          <div className="admin-detail-section">
            <p className="admin-detail-label">Videos ({videoFiles.length})</p>
            <VideoDurationCap
              instructorId={instructorId}
              initialSeconds={instructor.max_video_duration_seconds ?? null}
            />
            {videoFiles.length === 0 ? (
              <p className="admin-empty">no videos uploaded</p>
            ) : (
              <div className="admin-file-list">
                {videoFiles.map(f => (
                  <div key={f.file_id} className="admin-file-row">
                    <span className="file-chip-icon" style={{ background: '#e8f5e9', color: '#2e7d32', width: 'auto', padding: '0 6px', fontSize: '0.72rem' }}>Video</span>
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

          {/* feedback threads */}
          <div className="admin-detail-section">
            <p className="admin-detail-label">lesson plan threads ({feedback.length})</p>
            {feedback.length === 0 ? (
              <p className="admin-empty">no feedback generated yet</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                {feedback.map(fb => {
                  const title = fb.original_filename
                    ? fb.original_filename.replace(/\.pdf$/i, '')
                    : `Lesson · ${new Date(fb.created_at).toLocaleDateString()}`
                  const preview = fb.feedback_text
                    ? fb.feedback_text.split('\n').find((l: string) => l.trim().length > 0)?.slice(0, 120)
                    : null
                  return (
                    <div key={fb.id} style={{ border: '1px solid #e5e7eb', borderRadius: '0.5rem', padding: '1rem' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.4rem' }}>
                        <div>
                          <p style={{ fontWeight: 600, fontSize: '0.9rem', marginBottom: '0.2rem' }}>
                            📄 {title}
                          </p>
                          <p style={{ fontSize: '0.75rem', color: '#6b7280' }}>
                            {new Date(fb.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                          </p>
                        </div>
                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                          {fb.lessonPlanUrl && (
                            <a
                              href={fb.lessonPlanUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="msg-action-btn"
                            >
                              ↓ Lesson Plan
                            </a>
                          )}
                          <a
                            href={`/feedback/${fb.id}`}
                            target="_blank"
                            rel="noreferrer"
                            className="msg-action-btn"
                          >
                            ↓ View Feedback
                          </a>
                        </div>
                      </div>
                      {preview && (
                        <p style={{ fontSize: '0.8rem', color: '#374151', lineHeight: 1.5, borderTop: '1px solid #f3f4f6', paddingTop: '0.5rem' }}>
                          {preview}…
                        </p>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
