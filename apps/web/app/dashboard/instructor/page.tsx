import { redirect } from 'next/navigation'

import LogoutButton from '@/components/LogoutButton'
import InstructorDashboardClient, {
  type InstructorUploadRow,
} from '@/components/InstructorDashboardClient'
import { createClient } from '@/lib/supabase/server'

function inferSourceType(filename: string | null | undefined): 'pdf' | 'video' {
  if (!filename) return 'pdf'

  const lower = filename.toLowerCase()
  if (
    lower.endsWith('.mp4') ||
    lower.endsWith('.mov') ||
    lower.endsWith('.webm') ||
    lower.endsWith('.m4v')
  ) {
    return 'video'
  }

  return 'pdf'
}

function mapFeedbackStatus(
  status: string | null | undefined
): InstructorUploadRow['feedbackStatus'] {
  switch (status) {
    case 'uploaded':
      return 'uploaded'
    case 'transcribing':
      return 'transcribing'
    case 'generating':
      return 'generating'
    case 'failed':
      return 'failed'
    case 'ready':
    case 'complete':
      return 'ready'
    default:
      return 'not_started'
  }
}

export default async function InstructorDashboardPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (profile?.role === 'admin') {
    redirect('/admin')
  }

  const [{ data: files, error: filesError }, { data: feedbackRows, error: feedbackError }] =
    await Promise.all([
      supabase
        .from('files')
        .select('file_id, storage_path, original_name, created_at')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false }),
      supabase
        .from('feedback')
        .select('id, lesson_plan_id, storage_path, original_filename, status, created_at')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false }),
    ])

  const loadError = filesError?.message ?? feedbackError?.message ?? null

  const uploadRows: InstructorUploadRow[] = [
    ...(files ?? []).map((file) => {
      const matchingFeedback = (feedbackRows ?? []).find(
        (row) => row.lesson_plan_id === file.file_id
      )

      return {
        fileId: file.file_id,
        fileName: file.original_name,
        sourceStoragePath: file.storage_path,
        uploadedAt: file.created_at ?? null,
        sourceType: 'pdf' as const,
        feedbackStatus: matchingFeedback
          ? mapFeedbackStatus(matchingFeedback.status)
          : ('not_started' as const),
        feedbackId: matchingFeedback?.id ?? null,
        errorMessage: null,
      }
    }),

    ...(feedbackRows ?? [])
      .filter((row) => inferSourceType(row.original_filename) === 'video')
      .map((row) => ({
        fileId: row.lesson_plan_id,
        fileName: row.original_filename ?? 'Uploaded video',
        sourceStoragePath: row.storage_path ?? '',
        uploadedAt: row.created_at ?? null,
        sourceType: 'video' as const,
        feedbackStatus: mapFeedbackStatus(row.status),
        feedbackId: row.id ?? null,
        errorMessage: null,
      })),
  ].sort((a, b) => {
    const left = a.uploadedAt ? new Date(a.uploadedAt).getTime() : 0
    const right = b.uploadedAt ? new Date(b.uploadedAt).getTime() : 0
    return right - left
  })

  return (
    <div className="instructor-dashboard-page">
      <aside className="dashboard-sidebar">
        <div className="dashboard-sidebar-block">
          <p className="dashboard-brand">AllStarCode</p>
          <span className="badge instructor">Instructor</span>
        </div>

        <div className="dashboard-sidebar-block">
          <p className="dashboard-sidebar-label">Workspace</p>
          <p className="dashboard-sidebar-title">Lesson Feedback Dashboard</p>
          <p className="dashboard-sidebar-copy">
            Upload lesson plan PDFs or lesson videos, generate coaching feedback, and open
            completed feedback files from one place.
          </p>
        </div>

        <div className="dashboard-sidebar-block dashboard-sidebar-meta">
          <p className="dashboard-sidebar-label">Signed In As</p>
          <p className="dashboard-user-email">{user.email}</p>
        </div>

        <LogoutButton />
      </aside>

      <main className="dashboard-content">
        <header className="dashboard-hero">
          <div>
            <p className="dashboard-eyebrow">Instructor Dashboard</p>
            <h1>Uploads and feedback</h1>
            <p className="dashboard-hero-copy">
              This dashboard lives at <strong>/dashboard/instructor</strong>. New uploads appear
              after a successful upload and feedback becomes viewable as soon as generation
              finishes.
            </p>
          </div>

          <div className="dashboard-stat-card">
            <span className="dashboard-stat-label">Files tracked</span>
            <strong>{uploadRows.length}</strong>
          </div>
        </header>

        <InstructorDashboardClient
          instructorId={user.id}
          initialRows={uploadRows}
          initialLoadError={loadError}
        />
      </main>
    </div>
  )
}