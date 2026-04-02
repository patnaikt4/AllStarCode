'use client'

import { useCallback, useMemo, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import LogoutButton from '@/components/LogoutButton'

const LESSON_PLANS_BUCKET = 'lesson-plans'
const INITIAL_RAG_THREAD_ID = 'rag-initial'

const RAG_WELCOME_TEXT =
  'Upload a lesson plan PDF (optional). Nothing is sent until you click Send. Add notes if you like, then Send to generate curriculum-aligned feedback. If you skip the upload, we use a built-in sample lesson plan.'

type ThreadRow =
  | { id: string; type: 'demo'; title: string }
  | { id: string; type: 'rag'; title: string }

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

function welcomeMessages(): RagMessage[] {
  return [
    {
      id: 'welcome',
      role: 'assistant',
      text: RAG_WELCOME_TEXT,
      time: formatNow(),
    },
  ]
}

function emptyRagSession(): RagSession {
  return {
    messages: welcomeMessages(),
    lessonPlanId: null,
    pendingPdfName: null,
  }
}

function formatNow() {
  return new Date().toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  })
}

function newLessonTitle() {
  return `New lesson · ${formatNow()}`
}

const INITIAL_THREADS: ThreadRow[] = [
  { id: 'demo-1', type: 'demo', title: 'Intro to Variables' },
  { id: 'demo-2', type: 'demo', title: 'Loops & Iteration' },
  { id: 'demo-3', type: 'demo', title: 'Week 2 Lesson Plan' },
  { id: INITIAL_RAG_THREAD_ID, type: 'rag', title: 'Lesson plan feedback' },
]

type Props = {
  userId: string
  userEmail: string | undefined
}

export default function InstructorWorkspace({ userId, userEmail }: Props) {
  const supabase = useMemo(() => createClient(), [])
  const pdfInputRef = useRef<HTMLInputElement>(null)

  const [threads, setThreads] = useState<ThreadRow[]>(INITIAL_THREADS)
  const [activeId, setActiveId] = useState<string>('demo-1')
  const [ragSessions, setRagSessions] = useState<Record<string, RagSession>>(() => ({
    [INITIAL_RAG_THREAD_ID]: emptyRagSession(),
  }))
  const [input, setInput] = useState('')
  const [generating, setGenerating] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)

  const activeThread = threads.find((t) => t.id === activeId)
  const isRag = activeThread?.type === 'rag'
  const activeRagSession = isRag ? ragSessions[activeId] : undefined
  const ragMessages = activeRagSession?.messages ?? []

  const lastRagThreadId = useMemo(() => {
    const rag = threads.filter((t): t is Extract<ThreadRow, { type: 'rag' }> => t.type === 'rag')
    return rag.at(-1)?.id
  }, [threads])

  const ensureRagSession = useCallback((threadId: string) => {
    setRagSessions((prev) =>
      prev[threadId] ? prev : { ...prev, [threadId]: emptyRagSession() }
    )
  }, [])

  const goToLastRagThread = useCallback(() => {
    if (lastRagThreadId) {
      setActiveId(lastRagThreadId)
      ensureRagSession(lastRagThreadId)
    }
  }, [lastRagThreadId, ensureRagSession])

  const handlePdfPick = () => {
    goToLastRagThread()
    pdfInputRef.current?.click()
  }

  const handlePdfFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || file.type !== 'application/pdf') {
      setUploadError('Please choose a PDF file.')
      return
    }

    goToLastRagThread()
    setUploadError(null)

    const targetId = lastRagThreadId
    if (!targetId) return

    const id = crypto.randomUUID()
    setRagSessions((prev) => {
      const base = prev[targetId] ?? emptyRagSession()
      return {
        ...prev,
        [targetId]: {
          ...base,
          lessonPlanId: id,
          pendingPdfName: file.name,
        },
      }
    })

    const path = `${userId}/${id}.pdf`
    const { error } = await supabase.storage
      .from(LESSON_PLANS_BUCKET)
      .upload(path, file, {
        contentType: 'application/pdf',
        upsert: true,
      })

    if (error) {
      setUploadError(
        `Could not upload PDF (${error.message}). You can still send — feedback will use the sample lesson plan unless storage is configured.`
      )
    } else {
      setUploadError(null)
    }
  }

  const handleVideoClick = () => {
    goToLastRagThread()
    setUploadError(
      'Video lesson review is not available yet. Upload a PDF lesson plan to use RAG feedback.'
    )
  }

  const handleSend = async () => {
    if (!isRag || !activeRagSession) {
      goToLastRagThread()
      setUploadError(
        'You switched to a lesson chat. Add a PDF (optional) and click Send to generate real feedback.'
      )
      return
    }

    const threadId = activeId
    const session = ragSessions[threadId]
    if (!session) return

    const note = input.trim()
    const planId = session.lessonPlanId ?? crypto.randomUUID()

    let displayText: string
    if (note) {
      displayText = note
    } else if (session.pendingPdfName) {
      displayText = 'Please review this lesson plan and suggest improvements.'
    } else {
      displayText =
        'Generate curriculum-aligned feedback for the sample lesson plan.'
    }

    setRagSessions((prev) => ({
      ...prev,
      [threadId]: {
        ...prev[threadId]!,
        messages: [
          ...prev[threadId]!.messages,
          {
            id: crypto.randomUUID(),
            role: 'user',
            text: displayText,
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
        body: JSON.stringify({
          instructorId: userId,
          lessonPlanId: planId,
        }),
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

      let assistantText =
        'Your feedback PDF is ready. Open it for the full write-up.'
      if (data.usedPlaceholderLessonPlan) {
        assistantText +=
          ' (No lesson plan file was found in storage for this ID, so the built-in sample was used.)'
      }

      setRagSessions((prev) => {
        const s = prev[threadId]
        if (!s) return prev
        return {
          ...prev,
          [threadId]: {
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
      setRagSessions((prev) => {
        const s = prev[threadId]
        if (!s) return prev
        return {
          ...prev,
          [threadId]: {
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
  }

  const demoMessageCount = 4
  const ragCount = ragMessages.length

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
          <button
            type="button"
            className="sidebar-new-btn"
            onClick={() => {
              const id = crypto.randomUUID()
              setThreads((prev) => [
                ...prev,
                { id, type: 'rag', title: newLessonTitle() },
              ])
              setRagSessions((prev) => ({
                ...prev,
                [id]: emptyRagSession(),
              }))
              setActiveId(id)
              setInput('')
              setUploadError(null)
            }}
          >
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
                if (t.type === 'rag' && !ragSessions[t.id]) {
                  setRagSessions((prev) => ({
                    ...prev,
                    [t.id]: emptyRagSession(),
                  }))
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
              {t.type === 'rag' ? '✨ ' : ''}
              {t.title}
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
          <p className="instructor-topbar-title">
            {activeThread?.title ?? 'Chat'}
          </p>
          <span className="instructor-topbar-meta">
            {isRag
              ? `${ragCount} message${ragCount === 1 ? '' : 's'}`
              : `${demoMessageCount} messages`}
          </span>
        </div>

        <div className="instructor-thread">
          {isRag ? (
            <>
              {ragMessages.map((m) => (
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
                          ? {
                              background: '#fef2f2',
                              border: '1px solid #fecaca',
                              color: '#991b1b',
                            }
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
            </>
          ) : (
            <>
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
                  <span className="msg-action-btn" style={{ opacity: 0.45, cursor: 'not-allowed' }}>
                    ↓ View Feedback File
                  </span>
                </div>
              </div>

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
                  <span className="msg-action-btn" style={{ opacity: 0.45, cursor: 'not-allowed' }}>
                    ↓ View Feedback File
                  </span>
                </div>
              </div>
            </>
          )}
        </div>

        <div className="instructor-bottom-bar">
          {uploadError && (
            <p
              style={{
                fontSize: '0.78rem',
                color: '#b45309',
                marginBottom: 8,
                lineHeight: 1.45,
              }}
            >
              {uploadError}
            </p>
          )}
          {!isRag && (
            <p
              style={{
                fontSize: '0.78rem',
                color: '#6b7280',
                marginBottom: 10,
              }}
            >
              Preview threads above. Open a <strong>✨ lesson</strong> chat for live RAG
              feedback.
            </p>
          )}
          {isRag && activeRagSession?.pendingPdfName && (
            <p style={{ fontSize: '0.78rem', color: '#374151', marginBottom: 8 }}>
              Ready to generate for: <strong>{activeRagSession.pendingPdfName}</strong>
            </p>
          )}
          <div className="bottom-bar-uploads">
            <button
              type="button"
              className="upload-btn"
              onClick={handleVideoClick}
            >
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
