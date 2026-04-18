'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export default function InviteCallbackPage() {
  const router = useRouter()
  const supabase = createClient()

  useEffect(() => {
    // Extract tokens from the hash fragment before anything clears it
    const params = new URLSearchParams(window.location.hash.slice(1))
    const accessToken = params.get('access_token')
    const refreshToken = params.get('refresh_token')

    if (accessToken && refreshToken) {
      // Sign out any existing user, then set the invite session from the hash tokens
      supabase.auth.signOut().then(() =>
        supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken })
      ).then(({ error }) => {
        if (!error) router.replace('/invite/accept')
      })
    } else {
      // No hash tokens — fall back to existing session (e.g. page reload)
      supabase.auth.getSession().then(({ data: { session } }) => {
        if (session) router.replace('/invite/accept')
      })
    }
  }, [router, supabase])

  return (
    <main style={{ textAlign: 'center', paddingTop: '4rem' }}>
      <div style={{
        width: 36,
        height: 36,
        border: '3px solid #e5e7eb',
        borderTop: '3px solid #2563eb',
        borderRadius: '50%',
        animation: 'spin 0.8s linear infinite',
        margin: '0 auto 1rem',
      }} />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      <p style={{ color: '#6b7280', fontSize: '0.9rem' }}>Setting up your account…</p>
    </main>
  )
}
