'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import LogoutButton from '@/components/LogoutButton'
import type { FeedbackStatus, SourceType } from '@/lib/feedback/status'
import { FEEDBACK_STATUSES } from '@/lib/feedback/status'

const LESSON_PLANS_BUCKET = 'lesson-plans'
const NEW_THREAD_ID = 'new'

const TERMINAL_STATUSES: FeedbackStatus[] = ['complete', 'failed']
const POLL_INTERVAL_MS = 4000

const RAG_WELCOME_TEXT =
  'Upload a lesson plan PDF (optional). Nothing is sent until you click Send. Add notes if you like, then Send to generate curriculum-aligned feedback. If you skip the upload, we use a built-in sample lesson plan.'

type Thread = {
  id: string
  title: string
}

type RagMessage = {
  id: string
  role: 'user' | 'assistant'
  text: string
  time: string
  fileName?: string
  fileKind?: 'pdf' | 'video'
  feedbackId?: string
  feedbackStatus?: string
  sourceType?: string
  isError?: boolean
}

type RagSession = {
  messages: RagMessage[]
  lessonPlanId: string | null
  pendingPdfName: string | null
}

function formatNow() {
  return new Date().toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  })
}

function formatTime(dateStr: string) {
  return new Date(dateStr).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  })
}

function titleFromFilename(filename: string | null | undefined): string {
  if (!filename) return `Lesson · ${formatNow()}`
  return filename.replace(/\.pdf$/i, '')
}

function welcomeSession(): RagSession {
  return {
    messages: [
      {
        id: 'welcome',
        role: 'assistant',
        text: RAG_WELCOME_TEXT,
        time: formatNow(),
      },
    ],
    lessonPlanId: null,
    pendingPdfName: null,
  }
}

type Props = {
  userId: string
  userEmail: string | undefined
}

export default function InstructorWorkspace({ userId, userEmail }: Props) {
  const supabase = useMemo(() => createClient(), [])
  const pdfInputRef = useRef<HTMLInputElement>(null)

  const [threads, setThreads] = useState<Thread[]>([
    { id: NEW_THREAD_ID, title: 'New lesson' },
  ])
  const [activeId, setActiveId] = useState<string>(NEW_THREAD_ID)
  const [sessions, setSessions] = useState<Record<string, RagSession>>({
    [NEW_THREAD_ID]: welcomeSession(),
  })
  const [input, setInput] = useState('')
  const [generating, setGenerating] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)

  // Load feedback history from Supabase on mount
  useEffect(() => {
    async function loadHistory() {
      const { data } = await supabase
        .from('feedback')
        .select('id, original_filename, status, source_type, created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(30)

      if (!data || data.length === 0) return

      const historyThreads: Thread[] = data.map((row) => ({
        id: row.id,
        title: titleFromFilename(row.original_filename),
      }))

      const historySessions: Record<string, RagSession> = {}
      for (const row of data) {
        const time = row.created_at ? formatTime(row.created_at) : formatNow()
        const status = (row.status as FeedbackStatus) ?? 'complete'
        const sourceType = (row.source_type as SourceType) ?? 'pdf'

        let assistantText: string
        let isError = false
        if (status === 'complete') {
          assistantText = 'Your feedback PDF is ready. Open it for the full write-up.'
        } else if (status === 'failed') {
          assistantText = 'Feedback generation failed. Please try again.'
          isError = true
        } else if (status === 'uploaded') {
          assistantText = 'Upload received. Waiting to start processing...'
        } else if (status === 'transcribing') {
          assistantText = 'Transcribing your video...'
        } else {
          assistantText = 'Generating feedback...'
        }

        historySessions[row.id] = {
          messages: [
            {
              id: `user-${row.id}`,
              role: 'user',
              text: 'Please review this lesson plan and suggest improvements.',
              time,
              ...(row.original_filename
                ? { fileName: row.original_filename, fileKind: sourceType as 'pdf' | 'video' }
                : {}),
            },
            {
              id: `assistant-${row.id}`,
              role: 'assistant',
              text: assistantText,
              time,
              feedbackId: status === 'complete' ? row.id : undefined,
              feedbackStatus: status,
              sourceType,
              isError,
            },
          ],
          lessonPlanId: null,
          pendingPdfName: null,
        }
      }

      setThreads((prev) => {
        const existingIds = new Set(prev.map((t) => t.id))
        const deduped = historyThreads.filter((t) => !existingIds.has(t.id))
        return [...deduped, ...prev]
      })
      setSessions((prev) => ({ ...historySessions, ...prev }))
    }

    void loadHistory()
  }, [supabase, userId])

  // Poll for in-progress feedback items until they reach a terminal state.
  useEffect(() => {
    function getInProgressIds(): string[] {
      const ids: string[] = []
      for (const [threadId, session] of Object.entries(sessions)) {
        if (threadId === NEW_THREAD_ID) continue
        for (const msg of session.messages) {
          if (
            msg.role === 'assistant' &&
            msg.feedbackStatus &&
            !TERMINAL_STATUSES.includes(msg.feedbackStatus as FeedbackStatus)
          ) {
            ids.push(threadId)
          }
        }
      }
      return ids
    }

    const pending = getInProgressIds()
    if (pending.length === 0) return

    const timer = setInterval(async () => {
      const { data: rows } = await supabase
        .from('feedback')
        .select('id, status, source_type')
        .in('id', pending)

      if (!rows || rows.length === 0) return

      setSessions((prev) => {
        const next = { ...prev }
        for (const row of rows) {
          const s = next[row.id]
          if (!s) continue
          const status = row.status as FeedbackStatus
          const oldAssistant = s.messages.find(
            (m) => m.id === `assistant-${row.id}`
          )
          if (!oldAssistant || oldAssistant.feedbackStatus === status) continue

          let text: string
          let isError = false
          let feedbackId: string | undefined
          if (status === 'complete') {
            text = 'Your feedback PDF is ready. Open it for the full write-up.'
            feedbackId = row.id
          } else if (status === 'failed') {
            text = 'Feedback generation failed. Please try again.'
            isError = true
          } else if (status === 'uploaded') {
            text = 'Upload received. Waiting to start processing...'
          } else if (status === 'transcribing') {
            text = 'Transcribing your video...'
          } else {
            text = 'Generating feedback...'
          }

          next[row.id] = {
            ...s,
            messages: s.messages.map((m) =>
              m.id === `assistant-${row.id}`
                ? { ...m, text, feedbackStatus: status, feedbackId, isError }
                : m
            ),
          }
        }
        return next
      })
    }, POLL_INTERVAL_MS)

    return () => clearInterval(timer)
  }, [sessions, supabase])

  const activeSession = sessions[activeId] ?? welcomeSession()
  const activeThread = threads.find((t) => t.id === activeId)
  const messages = activeSession.messages

  const handlePdfPick = () => {
    pdfInputRef.current?.click()
  }

  const handlePdfFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || file.type !== 'application/pdf') {
      setUploadError('Please choose a PDF file.')
      return
    }

    setUploadError(null)

    const lessonPlanId = crypto.randomUUID()
    const title = titleFromFilename(file.name)

    // Update thread title to reflect the uploaded file
    setThreads((prev) =>
      prev.map((t) => (t.id === activeId ? { ...t, title } : t))
    )

    setSessions((prev) => ({
      ...prev,
      [activeId]: {
        ...(prev[activeId] ?? welcomeSession()),
        lessonPlanId,
        pendingPdfName: file.name,
      },
    }))

    const path = `${userId}/${lessonPlanId}.pdf`
    const { error } = await supabase.storage
      .from(LESSON_PLANS_BUCKET)
      .upload(path, file, { contentType: 'application/pdf', upsert: true })

    if (error) {
      setUploadError(
        `Could not upload PDF (${error.message}). You can still send — feedback will use the sample lesson plan.`
      )
    }
  }

  const handleVideoClick = () => {
    setUploadError(
      'Video lesson review is not available yet. Upload a PDF lesson plan to use RAG feedback.'
    )
  }

  const handleSend = useCallback(async () => {
    const session = sessions[activeId] ?? welcomeSession()
    const note = input.trim()
    const planId = session.lessonPlanId ?? crypto.randomUUID()

    const userText = note
      ? note
      : session.pendingPdfName
        ? 'Please review this lesson plan and suggest improvements.'
        : 'Generate curriculum-aligned feedback for the sample lesson plan.'

    setSessions((prev) => ({
      ...prev,
      [activeId]: {
        ...(prev[activeId] ?? welcomeSession()),
        messages: [
          ...(prev[activeId]?.messages ?? welcomeSession().messages),
          {
            id: crypto.randomUUID(),
            role: 'user',
            text: userText,
            time: formatNow(),
            ...(session.pendingPdfName
              ? { fileName: session.pendingPdfName, fileKind: 'pdf' as const }
              : {}),
          },
        ],
        lessonPlanId: session.lessonPlanId ?? planId,
      },
    }))
    setInput('')
    setGenerating(true)
    setUploadError(null)

    try {
      const res = await fetch('/api/feedback/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instructorId: userId, lessonPlanId: planId, originalFilename: session.pendingPdfName }),
      })

      const raw = await res.text()
      let data: {
        success?: boolean
        feedbackId?: string
        error?: string
        usedPlaceholderLessonPlan?: boolean
      } = {}

      if (raw) {
        try {
          data = JSON.parse(raw) as typeof data
        } catch {
          throw new Error(
            `Server returned a non-JSON response (${res.status}). Try again or check server logs.`
          )
        }
      }

      if (!res.ok || !data.success || !data.feedbackId) {
        throw new Error(data.error || 'Could not generate feedback.')
      }

      let assistantText = 'Your feedback PDF is ready. Open it for the full write-up.'
      if (data.usedPlaceholderLessonPlan) {
        assistantText +=
          ' (No lesson plan file was found in storage for this ID, so the built-in sample was used.)'
      }

      setSessions((prev) => {
        const s = prev[activeId] ?? welcomeSession()
        return {
          ...prev,
          [activeId]: {
            ...s,
            messages: [
              ...s.messages,
              {
                id: crypto.randomUUID(),
                role: 'assistant',
                text: assistantText,
                time: formatNow(),
                feedbackId: data.feedbackId,
              },
            ],
            lessonPlanId: null,
            pendingPdfName: null,
          },
        }
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Something went wrong.'
      setSessions((prev) => {
        const s = prev[activeId] ?? welcomeSession()
        return {
          ...prev,
          [activeId]: {
            ...s,
            messages: [
              ...s.messages,
              {
                id: crypto.randomUUID(),
                role: 'assistant',
                text: msg,
                time: formatNow(),
                isError: true,
              },
            ],
          },
        }
      })
    } finally {
      setGenerating(false)
    }
  }, [activeId, input, sessions, userId])

  const handleNewThread = useCallback(() => {
    const id = crypto.randomUUID()
    setThreads((prev) => [...prev, { id, title: 'New lesson' }])
    setSessions((prev) => ({ ...prev, [id]: welcomeSession() }))
    setActiveId(id)
    setInput('')
    setUploadError(null)
  }, [])

  return (
    <div className="instructor-shell">
      <input
        ref={pdfInputRef}
        type="file"
        accept="application/pdf"
        style={{ display: 'none' }}
        onChange={handlePdfFile}
      />

      <aside className="instructor-sidebar">
        <div className="sidebar-header">
          <p className="sidebar-brand">AllStarCode</p>
          <button type="button" className="sidebar-new-btn" onClick={handleNewThread}>
            <span>＋</span> New Lesson
          </button>
        </div>

        <nav className="sidebar-nav">
          <p className="sidebar-nav-label">Recent</p>
          {threads.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`sidebar-nav-item${activeId === t.id ? ' active' : ''}`}
              onClick={() => {
                setActiveId(t.id)
                if (!sessions[t.id]) {
                  setSessions((prev) => ({ ...prev, [t.id]: welcomeSession() }))
                }
              }}
              style={{
                width: '100%',
                border: 'none',
                background: 'transparent',
                font: 'inherit',
                textAlign: 'left',
                cursor: 'pointer',
              }}
            >
              ✨ {t.title}
            </button>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="sidebar-user-info">
            <span className="badge instructor">Instructor</span>
            <span className="sidebar-user-email">{userEmail}</span>
          </div>
          <LogoutButton />
        </div>
      </aside>

      <div className="instructor-main">
        <div className="instructor-topbar">
          <p className="instructor-topbar-title">{activeThread?.title ?? 'Chat'}</p>
          <span className="instructor-topbar-meta">
            {messages.length} message{messages.length === 1 ? '' : 's'}
          </span>
        </div>

        <div className="instructor-thread">
          {messages.map((m) => (
            <div
              key={m.id}
              className={`instructor-message ${m.role === 'user' ? 'user' : 'assistant'}`}
            >
              <div className={`msg-avatar ${m.role === 'user' ? 'user' : 'assistant'}`}>
                {m.role === 'user' ? 'You' : 'AI'}
              </div>
              <div className="msg-content">
                <div
                  className="msg-bubble"
                  style={
                    m.role === 'assistant' && m.isError
                      ? { background: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b' }
                      : undefined
                  }
                >
                  {m.fileName && m.fileKind && (
                    <div className="file-chip">
                      <span className="file-chip-icon">{m.fileKind === 'video' ? '▶' : 'PDF'}</span>
                      {m.fileName}
                    </div>
                  )}
                  {m.text}
                </div>
                <span className="msg-time">{m.time}</span>
                {m.role === 'assistant' && m.feedbackStatus && !m.isError && m.feedbackStatus !== 'complete' && (
                  <span style={{ fontSize: '0.75rem', color: '#6b7280', marginTop: 4, display: 'inline-block' }}>
                    Status: {m.feedbackStatus}
                  </span>
                )}
                {m.role === 'assistant' && m.sourceType && (
                  <span style={{ fontSize: '0.7rem', color: '#9ca3af', marginTop: 2, display: 'inline-block', marginLeft: m.feedbackStatus && m.feedbackStatus !== 'complete' ? 8 : 0 }}>
                    {m.sourceType === 'video' ? '▶ Video' : '📄 PDF'}
                  </span>
                )}
                {m.role === 'assistant' && m.feedbackId && !m.isError && (
                  <a
                    className="msg-action-btn"
                    href={`/feedback/${m.feedbackId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    ↓ View Feedback File
                  </a>
                )}
              </div>
            </div>
          ))}
          {generating && (
            <div className="instructor-message assistant">
              <div className="msg-avatar assistant">AI</div>
              <div className="msg-content">
                <div className="msg-bubble" style={{ color: '#6b7280' }}>
                  Generating feedback…
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="instructor-bottom-bar">
          {uploadError && (
            <p style={{ fontSize: '0.78rem', color: '#b45309', marginBottom: 8, lineHeight: 1.45 }}>
              {uploadError}
            </p>
          )}
          {activeSession.pendingPdfName && (
            <p style={{ fontSize: '0.78rem', color: '#374151', marginBottom: 8 }}>
              Ready to generate for: <strong>{activeSession.pendingPdfName}</strong>
            </p>
          )}
          <div className="bottom-bar-uploads">
            <button type="button" className="upload-btn" onClick={handleVideoClick}>
              <span className="upload-icon">▶</span>
              Upload Video
            </button>
            <button type="button" className="upload-btn" onClick={handlePdfPick}>
              <span className="upload-icon">📄</span>
              Upload PDF
            </button>
          </div>
          <div className="bottom-bar-row">
            <input
              className="chat-input"
              type="text"
              placeholder="Ask a question or add instructions…"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  if (!generating) void handleSend()
                }
              }}
            />
            <button
              type="button"
              className="send-btn"
              disabled={generating}
              onClick={() => void handleSend()}
            >
              {generating ? '…' : 'Send'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
