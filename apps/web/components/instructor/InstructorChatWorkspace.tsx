'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

type ChatSession = {
  id: string
  title: string | null
  created_at: string | null
  updated_at: string | null
}

type ChatMessage = {
  id: string
  role: string
  content: string
  created_at: string | null
}

function formatTime(dateStr: string | null) {
  if (!dateStr) return ''
  return new Date(dateStr).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  })
}

type Props = {
  userEmail: string | undefined
}

export default function InstructorChatWorkspace({ userEmail }: Props) {
  const [sessions, setSessions] = useState<ChatSession[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [isDraft, setIsDraft] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [generating, setGenerating] = useState(false)
  const [sessionsLoading, setSessionsLoading] = useState(true)
  const [messagesLoading, setMessagesLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const threadRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const scrollToBottom = useCallback(() => {
    if (threadRef.current) {
      threadRef.current.scrollTop = threadRef.current.scrollHeight
    }
  }, [])

  useEffect(() => {
    scrollToBottom()
  }, [messages, generating, scrollToBottom])

  const loadSessions = useCallback(async () => {
    try {
      const res = await fetch('/api/chat/sessions')
      const data = (await res.json()) as {
        success: boolean
        sessions?: ChatSession[]
        error?: string
      }
      if (data.success && data.sessions) {
        setSessions(data.sessions)
      }
    } catch {
      // silently fail — sidebar list not critical
    } finally {
      setSessionsLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadSessions()
  }, [loadSessions])

  const selectSession = useCallback(
    async (sessionId: string) => {
      setActiveSessionId(sessionId)
      setIsDraft(false)
      setError(null)
      setMessagesLoading(true)
      setMessages([])

      try {
        const res = await fetch(`/api/chat/sessions/${sessionId}`)

        if (res.status === 404) {
          void loadSessions()
          setActiveSessionId(null)
          return
        }

        const data = (await res.json()) as {
          success: boolean
          messages?: ChatMessage[]
          error?: string
        }

        if (data.success && data.messages) {
          setMessages(data.messages)
        } else {
          setError(data.error ?? 'Failed to load messages.')
        }
      } catch {
        setError('Failed to load messages.')
      } finally {
        setMessagesLoading(false)
      }
    },
    [loadSessions]
  )

  const handleNewChat = useCallback(() => {
    setActiveSessionId(crypto.randomUUID())
    setIsDraft(true)
    setMessages([])
    setInput('')
    setError(null)
    setTimeout(() => inputRef.current?.focus(), 50)
  }, [])

  const handleSend = useCallback(async () => {
    const text = input.trim()
    if (!text || generating) return

    const sessionId = activeSessionId ?? crypto.randomUUID()
    if (!activeSessionId) {
      setActiveSessionId(sessionId)
      setIsDraft(true)
    }

    const tempId = crypto.randomUUID()
    const tempUserMsg: ChatMessage = {
      id: tempId,
      role: 'user',
      content: text,
      created_at: new Date().toISOString(),
    }

    setMessages((prev) => [...prev, tempUserMsg])
    setInput('')
    setGenerating(true)
    setError(null)

    try {
      const res = await fetch('/api/chat/message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, message: text }),
      })

      const data = (await res.json()) as {
        success: boolean
        assistantMessage?: string
        error?: string
      }

      if (!res.ok || !data.success) {
        throw new Error(data.error ?? 'Failed to send message.')
      }

      const assistantMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: data.assistantMessage ?? '',
        created_at: new Date().toISOString(),
      }

      setMessages((prev) => [...prev, assistantMsg])

      if (isDraft) {
        setIsDraft(false)
      }

      void loadSessions()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Something went wrong.'
      setError(msg)
      setMessages((prev) => prev.filter((m) => m.id !== tempId))
    } finally {
      setGenerating(false)
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [input, generating, activeSessionId, isDraft, loadSessions])

  const currentTitle = isDraft
    ? 'New Chat'
    : sessions.find((s) => s.id === activeSessionId)?.title ?? 'Chat'

  return (
    <div className="instructor-shell">
      <aside className="instructor-sidebar">
        <div className="sidebar-header">
          <p className="sidebar-brand">AllStarCode</p>
          <button type="button" className="sidebar-new-btn" onClick={handleNewChat}>
            <span>+</span> New Chat
          </button>
        </div>

        <nav className="sidebar-nav">
          <p className="sidebar-nav-label">History</p>

          {sessionsLoading ? (
            <>
              <div className="chat-sidebar-skeleton" />
              <div className="chat-sidebar-skeleton" />
              <div className="chat-sidebar-skeleton" />
            </>
          ) : sessions.length === 0 ? (
            <p className="chat-sidebar-empty">No conversations yet.</p>
          ) : (
            sessions.map((s) => (
              <button
                key={s.id}
                type="button"
                className={`sidebar-nav-item${activeSessionId === s.id && !isDraft ? ' active' : ''}`}
                onClick={() => void selectSession(s.id)}
                style={{
                  width: '100%',
                  border: 'none',
                  background: 'transparent',
                  font: 'inherit',
                  textAlign: 'left',
                  cursor: 'pointer',
                }}
              >
                {s.title ?? 'Untitled'}
              </button>
            ))
          )}
        </nav>

        <div className="sidebar-footer">
          <div className="sidebar-user-info">
            <span className="badge instructor">Instructor</span>
            <span className="sidebar-user-email">{userEmail}</span>
          </div>
          <a href="/dashboard/instructor" className="logout-btn" style={{ textDecoration: 'none' }}>
            Dashboard
          </a>
        </div>
      </aside>

      <div className="instructor-main">
        <div className="instructor-topbar">
          <p className="instructor-topbar-title">{currentTitle}</p>
          <span className="instructor-topbar-meta">
            {!activeSessionId ? 'No session selected' : isDraft ? 'New conversation' : `${messages.length} message${messages.length === 1 ? '' : 's'}`}
          </span>
        </div>

        <div className="instructor-thread" ref={threadRef}>
          {!activeSessionId ? (
            <div className="chat-empty-state">
              <p>Click <strong>+ New Chat</strong> or select a past conversation from the sidebar.</p>
            </div>
          ) : messagesLoading ? (
            <>
              <div className="chat-msg-skeleton assistant" />
              <div className="chat-msg-skeleton user" />
              <div className="chat-msg-skeleton assistant" />
            </>
          ) : messages.length === 0 ? (
            <div className="chat-empty-state">
              <p>Ask a question about the AllStarCode curriculum.</p>
            </div>
          ) : (
            messages.map((m) => (
              <div
                key={m.id}
                className={`instructor-message ${m.role === 'user' ? 'user' : 'assistant'}`}
              >
                <div className={`msg-avatar ${m.role === 'user' ? 'user' : 'assistant'}`}>
                  {m.role === 'user' ? 'You' : 'AI'}
                </div>
                <div className="msg-content">
                  <div className="msg-bubble">{m.content}</div>
                  <span className="msg-time">{formatTime(m.created_at)}</span>
                </div>
              </div>
            ))
          )}

          {generating && (
            <div className="instructor-message assistant">
              <div className="msg-avatar assistant">AI</div>
              <div className="msg-content">
                <div className="msg-bubble chat-typing-indicator">
                  <span />
                  <span />
                  <span />
                </div>
              </div>
            </div>
          )}
        </div>

        {error && <div className="chat-error-banner">{error}</div>}

        <div className="instructor-bottom-bar">
          <div className="bottom-bar-row">
            <input
              ref={inputRef}
              className="chat-input"
              type="text"
              placeholder={activeSessionId ? 'Type a message…' : 'Start a new chat first…'}
              value={input}
              disabled={generating || !activeSessionId}
              aria-label="Chat message"
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  void handleSend()
                }
              }}
            />
            <button
              type="button"
              className="send-btn"
              disabled={generating || !input.trim() || !activeSessionId}
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
