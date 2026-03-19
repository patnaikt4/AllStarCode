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
    <div className="instructor-shell">
      {/* ── Sidebar ────────────────────────────────────── */}
      <aside className="instructor-sidebar">
        <div className="sidebar-header">
          <p className="sidebar-brand">AllStarCode</p>
          <button className="sidebar-new-btn">
            <span>＋</span> New Lesson
          </button>
        </div>

        <nav className="sidebar-nav">
          <p className="sidebar-nav-label">Recent</p>
          <div className="sidebar-nav-item active">Intro to Variables</div>
          <div className="sidebar-nav-item">Loops &amp; Iteration</div>
          <div className="sidebar-nav-item">Week 2 Lesson Plan</div>
        </nav>

        <div className="sidebar-footer">
          <div className="sidebar-user-info">
            <span className="badge instructor">Instructor</span>
            <span className="sidebar-user-email">{user.email}</span>
          </div>
          <LogoutButton />
        </div>
      </aside>

      {/* ── Main area ──────────────────────────────────── */}
      <div className="instructor-main">
        {/* Top bar */}
        <div className="instructor-topbar">
          <p className="instructor-topbar-title">Intro to Variables</p>
          <span className="instructor-topbar-meta">4 messages</span>
        </div>

        {/* Message thread */}
        <div className="instructor-thread">

          {/* User — video upload */}
          <div className="instructor-message user">
            <div className="msg-avatar user">You</div>
            <div className="msg-content">
              <div className="msg-bubble">
                <div className="file-chip">
                  <span className="file-chip-icon">▶</span>
                  intro-variables.mp4
                </div>
                Please review this lesson video and suggest improvements.
              </div>
              <span className="msg-time">10:14 AM</span>
            </div>
          </div>

          {/* Assistant — video feedback */}
          <div className="instructor-message assistant">
            <div className="msg-avatar assistant">AI</div>
            <div className="msg-content">
              <div className="msg-bubble">
                I reviewed your lesson video on introducing variables. The pacing
                is strong and your examples are relatable. I&apos;d suggest adding a
                short recap at the end to reinforce the key concepts, and
                consider using more diverse variable name examples to keep
                students engaged throughout the lesson.
              </div>
              <span className="msg-time">10:14 AM</span>
              <button className="msg-action-btn">↓ View Feedback File</button>
            </div>
          </div>

          {/* User — PDF upload */}
          <div className="instructor-message user">
            <div className="msg-avatar user">You</div>
            <div className="msg-content">
              <div className="msg-bubble">
                <div className="file-chip">
                  <span className="file-chip-icon">PDF</span>
                  week-2-lesson-plan.pdf
                </div>
                Can you check this lesson plan for alignment with the curriculum?
              </div>
              <span className="msg-time">10:17 AM</span>
            </div>
          </div>

          {/* Assistant — PDF feedback */}
          <div className="instructor-message assistant">
            <div className="msg-avatar assistant">AI</div>
            <div className="msg-content">
              <div className="msg-bubble">
                Your Week 2 lesson plan aligns well with the core curriculum
                goals. The progression from variables to conditionals is logical
                and well-paced. I recommend adding one hands-on coding exercise
                per section to reinforce each concept before moving on to the
                next topic.
              </div>
              <span className="msg-time">10:17 AM</span>
              <button className="msg-action-btn">↓ View Feedback File</button>
            </div>
          </div>

        </div>

        {/* Bottom bar */}
        <div className="instructor-bottom-bar">
          <div className="bottom-bar-uploads">
            <button className="upload-btn">
              <span className="upload-icon">▶</span>
              Upload Video
            </button>
            <button className="upload-btn">
              <span className="upload-icon">📄</span>
              Upload PDF
            </button>
          </div>
          <div className="bottom-bar-row">
            <input
              className="chat-input"
              type="text"
              placeholder="Ask a question or add instructions…"
            />
            <button className="send-btn">Send</button>
          </div>
        </div>
      </div>
    </div>
  )
}
