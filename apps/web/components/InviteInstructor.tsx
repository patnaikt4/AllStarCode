'use client'

import { useState } from 'react'

type Status = { type: 'success' | 'error'; message: string } | null

export default function InviteInstructor() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState<Status>(null)
  const [inviteLink, setInviteLink] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setStatus(null)
    setInviteLink(null)
    setCopied(false)

    try {
      const res = await fetch('/api/admin/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })

      const data = (await res.json()) as { success?: boolean; error?: string; inviteLink?: string }

      if (!res.ok || !data.success) {
        setStatus({ type: 'error', message: data.error ?? 'Failed to generate invite link.' })
      } else {
        setStatus({ type: 'success', message: `Invite link generated for ${email}. Copy and send it manually.` })
        setInviteLink(data.inviteLink ?? null)
        setEmail('')
      }
    } catch {
      setStatus({ type: 'error', message: 'Network error. Please try again.' })
    } finally {
      setLoading(false)
    }
  }

  async function handleCopy() {
    if (!inviteLink) return
    await navigator.clipboard.writeText(inviteLink)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div style={{ marginBottom: '2rem' }}>
      <h2 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '0.75rem' }}>
        Invite Instructor
      </h2>
      <form onSubmit={handleInvite} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
        <input
          type="email"
          placeholder="instructor@email.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          style={{
            flex: 1,
            padding: '0.5rem 0.75rem',
            border: '1px solid #d1d5db',
            borderRadius: '0.375rem',
            fontSize: '0.875rem',
          }}
        />
        <button
          type="submit"
          disabled={loading}
          style={{
            padding: '0.5rem 1rem',
            background: '#2563eb',
            color: '#fff',
            border: 'none',
            borderRadius: '0.375rem',
            fontSize: '0.875rem',
            cursor: loading ? 'not-allowed' : 'pointer',
            opacity: loading ? 0.7 : 1,
          }}
        >
          {loading ? 'Generating…' : 'Generate Invite Link'}
        </button>
      </form>

      {status && (
        <p style={{ marginTop: '0.5rem', fontSize: '0.8rem', color: status.type === 'success' ? '#16a34a' : '#dc2626' }}>
          {status.message}
        </p>
      )}

      {inviteLink && (
        <div style={{ marginTop: '0.75rem', padding: '0.75rem', background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: '0.375rem' }}>
          <p style={{ fontSize: '0.75rem', color: '#6b7280', marginBottom: '0.4rem' }}>
            Copy this link and send it to the instructor:
          </p>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <code style={{ flex: 1, fontSize: '0.72rem', wordBreak: 'break-all', color: '#374151' }}>
              {inviteLink}
            </code>
            <button
              type="button"
              onClick={handleCopy}
              style={{
                padding: '0.3rem 0.6rem',
                background: copied ? '#16a34a' : '#374151',
                color: '#fff',
                border: 'none',
                borderRadius: '0.25rem',
                fontSize: '0.75rem',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
