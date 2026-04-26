'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import LogoutButton from '@/components/LogoutButton'

const LESSON_PLANS_BUCKET = 'lesson-plans'
const NEW_THREAD_ID = 'new'

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
  fileKind?: 'pdf'
  feedbackId?: string
  isError?: boolean
}

type RagSession = {
  messages: RagMessage[]
  lessonPlanId: string | null
  pendingPdfName: string | null
}

type ChatSessionRow = {
  id: string
  title: string | null
  created_at: string | null
  updated_at: string | null
}

type ChatMessageRow = {
  id: string
  session_id: string
  role: string
  content: string
  created_at: string | null
  feedback_id: string | null
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

  // Load chat history from Supabase on mount, with old feedback rows as fallback.
  useEffect(() => {
    async function loadHistory() {
      const { data: chatSessionRows, error: chatSessionError } = await supabase
        .from('chat_sessions')
        .select('id, title, created_at, updated_at')
        .eq('user_id', userId)
        .order('updated_at', { ascending: false })
        .limit(30)

      if (!chatSessionError && chatSessionRows && chatSessionRows.length > 0) {
        const chatSessions = chatSessionRows as ChatSessionRow[]
        const sessionIds = chatSessions.map((row) => row.id)
        const { data: chatMessageRows } = await supabase
          .from('chat_messages')
          .select('id, session_id, role, content, created_at, feedback_id')
          .in('session_id', sessionIds)
          .order('created_at', { ascending: true })

        const messagesBySession = new Map<string, ChatMessageRow[]>()

        for (const row of (chatMessageRows ?? []) as ChatMessageRow[]) {
          const rows = messagesBySession.get(row.session_id) ?? []
          rows.push(row)
          messagesBySession.set(row.session_id, rows)
        }

        const historyThreads: Thread[] = chatSessions.map((row) => ({
          id: row.id,
          title:
            row.title ||
            `Lesson · ${formatTime(row.updated_at ?? row.created_at ?? new Date().toISOString())}`,
        }))

        const historySessions: Record<string, RagSession> = {}

        for (const row of chatSessions) {
          const chatMessages = messagesBySession.get(row.id) ?? []
          historySessions[row.id] = {
            messages:
              chatMessages.length > 0
                ? chatMessages.map((message) => ({
                    id: message.id,
                    role: message.role === 'user' ? 'user' : 'assistant',
                    text: message.content,
                    time: message.created_at ? formatTime(message.created_at) : formatNow(),
                    ...(message.feedback_id ? { feedbackId: message.feedback_id } : {}),
                  }))
                : welcomeSession().messages,
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
        return
      }

      const { data } = await supabase
        .from('feedback')
        .select('id, original_filename, created_at')
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
        historySessions[row.id] = {
          messages: [
            {
              id: `user-${row.id}`,
              role: 'user',
              text: 'Please review this lesson plan and suggest improvements.',
              time,
              ...(row.original_filename
                ? { fileName: row.original_filename, fileKind: 'pdf' as const }
                : {}),
            },
            {
              id: `assistant-${row.id}`,
              role: 'assistant',
              text: 'Your feedback PDF is ready. Open it for the full write-up.',
              time,
              feedbackId: row.id,
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
    const targetSessionId =
      activeId === NEW_THREAD_ID ? crypto.randomUUID() : activeId
    const note = input.trim()
    const planId = session.lessonPlanId ?? crypto.randomUUID()

    const userText = note
      ? note
      : session.pendingPdfName
        ? 'Please review this lesson plan and suggest improvements.'
        : 'Generate curriculum-aligned feedback for the sample lesson plan.'
    const userMessage: RagMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      text: userText,
      time: formatNow(),
      ...(session.pendingPdfName
        ? { fileName: session.pendingPdfName, fileKind: 'pdf' as const }
        : {}),
    }
    const currentThreadTitle = activeThread?.title ?? 'New lesson'
    const nextThreadTitle = session.pendingPdfName
      ? titleFromFilename(session.pendingPdfName)
      : currentThreadTitle === 'New lesson'
        ? titleFromFilename(null)
        : currentThreadTitle

    if (targetSessionId !== activeId) {
      setActiveId(targetSessionId)
    }

    setThreads((prev) => {
      const nextThreads = prev.map((thread) =>
        thread.id === activeId
          ? { id: targetSessionId, title: nextThreadTitle }
          : thread
      )

      if (nextThreads.some((thread) => thread.id === targetSessionId)) {
        return nextThreads
      }

      return [...nextThreads, { id: targetSessionId, title: nextThreadTitle }]
    })

    setSessions((prev) => {
      const current = prev[activeId] ?? welcomeSession()
      const next = { ...prev }

      if (targetSessionId !== activeId) {
        delete next[activeId]
      }

      next[targetSessionId] = {
        ...current,
        messages: [...current.messages, userMessage],
        lessonPlanId: current.lessonPlanId ?? planId,
      }

      return next
    })
    setInput('')
    setGenerating(true)
    setUploadError(null)

    try {
      const res = await fetch('/api/feedback/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instructorId: userId,
          lessonPlanId: planId,
          originalFilename: session.pendingPdfName,
          sessionId: targetSessionId,
          message: userText,
        }),
      })

      const raw = await res.text()
      let data: {
        success?: boolean
        feedbackId?: string
        sessionId?: string
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
        const s = prev[targetSessionId] ?? welcomeSession()
        return {
          ...prev,
          [targetSessionId]: {
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
        const s = prev[targetSessionId] ?? welcomeSession()
        return {
          ...prev,
          [targetSessionId]: {
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
  }, [activeId, activeThread?.title, input, sessions, userId])

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
                  {m.fileName && m.fileKind === 'pdf' && (
                    <div className="file-chip">
                      <span className="file-chip-icon">PDF</span>
                      {m.fileName}
                    </div>
                  )}
                  {m.text}
                </div>
                <span className="msg-time">{m.time}</span>
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
