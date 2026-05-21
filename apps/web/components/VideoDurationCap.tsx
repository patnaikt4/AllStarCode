'use client'

import { useState } from 'react'

/**
 * VideoDurationCap — inline control on the instructor detail page
 * that lets an admin set (or clear) a maximum video upload duration
 * for a specific instructor.
 *
 * Calls PATCH /api/admin/instructors/[instructorId]/video-cap
 *
 * The database stores seconds; this UI displays minutes for readability.
 */
export default function VideoDurationCap({
  instructorId,
  initialSeconds,
}: {
  instructorId: string
  initialSeconds: number | null
}) {
  const [minutes, setMinutes] = useState(
    initialSeconds != null ? String(Math.round(initialSeconds / 60)) : ''
  )
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  async function handleSave() {
    setSaving(true)
    setMessage(null)

    const trimmed = minutes.trim()
    const seconds = trimmed === '' ? null : Math.round(Number(trimmed) * 60)

    if (seconds !== null && (isNaN(seconds) || seconds <= 0)) {
      setMessage('Enter a positive number of minutes.')
      setSaving(false)
      return
    }

    try {
      const res = await fetch(
        `/api/admin/instructors/${instructorId}/video-cap`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ maxVideoDurationSeconds: seconds }),
        }
      )

      if (res.ok) {
        setMessage('Saved!')
      } else {
        const err = await res.json().catch(() => null)
        setMessage(err?.error ?? 'Failed to save.')
      }
    } catch {
      setMessage('Network error.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.5rem',
        padding: '0.75rem 0',
        flexWrap: 'wrap',
      }}
    >
      <label
        htmlFor={`cap-${instructorId}`}
        style={{ fontSize: '0.82rem', color: '#555', whiteSpace: 'nowrap' }}
      >
        Max video length
      </label>
      <input
        id={`cap-${instructorId}`}
        type="number"
        min="1"
        step="1"
        placeholder="no limit"
        value={minutes}
        onChange={(e) => setMinutes(e.target.value)}
        style={{
          width: '80px',
          padding: '0.35rem 0.5rem',
          border: '1px solid #d1d5db',
          borderRadius: '0.375rem',
          fontSize: '0.82rem',
        }}
      />
      <span style={{ fontSize: '0.78rem', color: '#888' }}>min</span>
      <button
        onClick={handleSave}
        disabled={saving}
        style={{
          padding: '0.35rem 0.75rem',
          background: '#2563eb',
          color: '#fff',
          border: 'none',
          borderRadius: '0.375rem',
          fontSize: '0.78rem',
          cursor: saving ? 'not-allowed' : 'pointer',
          opacity: saving ? 0.7 : 1,
        }}
      >
        {saving ? '…' : 'Save'}
      </button>
      {message && (
        <span
          style={{
            fontSize: '0.78rem',
            color: message === 'Saved!' ? '#16a34a' : '#dc2626',
          }}
        >
          {message}
        </span>
      )}
    </div>
  )
}
