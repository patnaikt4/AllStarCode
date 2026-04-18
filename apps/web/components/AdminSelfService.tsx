'use client'

import { useState, useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'

type FileRow = {
  file_id: string
  original_name: string
  storage_path: string
  created_at: string
}

// handles the admin's own file uploads + shows only their own files
export default function AdminSelfService() {
  const [files, setFiles] = useState<FileRow[]>([])
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const supabase = createClient()

  async function loadFiles() {
    // filter by user_id so admin only sees their own files, not instructors'
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const { data } = await supabase
      .from('files')
      .select('file_id, original_name, storage_path, created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
    if (data) setFiles(data)
  }

  useEffect(() => { loadFiles() }, [])

  async function handleUpload(file: File) {
    setUploading(true)
    setError(null)
  
    try {
      const form = new FormData()
      form.append('file', file)
  
      const res = await fetch('/api/files/upload', {
        method: 'POST',
        body: form,
      })
  
      if (res.ok) {
        await loadFiles()
      } else {
        const data = await res.json().catch(() => null)
        setError(data?.error?.message ?? 'Upload failed.')
      }
    } catch (error) {
      console.error('upload request failed:', error)
      setError('Upload failed.')
    } finally {
      setUploading(false)
    }
  }

  // generates a short-lived signed URL and opens it in a new tab
  async function openFile(storagePath: string) {
    const { data } = await supabase.storage.from('documents').createSignedUrl(storagePath, 60)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank')
  }

  return (
    <div className="instructor-thread">
      <div className="admin-upload-area">
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf"
          style={{ display: 'none' }}
          onChange={e => e.target.files?.[0] && handleUpload(e.target.files[0])}
        />
        <button
          className="upload-btn"
          disabled={uploading}
          onClick={() => inputRef.current?.click()}
        >
          <span className="upload-icon">📄</span>
          {uploading ? 'uploading...' : 'upload pdf'}
        </button>
        {error && <p className="error" style={{ marginTop: 8 }}>{error}</p>}
      </div>

      {files.length === 0 ? (
        <p className="admin-empty">no files uploaded yet</p>
      ) : (
        <div className="admin-file-list">
          {files.map(f => (
            <div key={f.file_id} className="admin-file-row">
              <span className="file-chip-icon">PDF</span>
              <div className="admin-file-info">
                <button className="admin-file-link" onClick={() => openFile(f.storage_path)}>
                  {f.original_name}
                </button>
                <span className="admin-file-date">{new Date(f.created_at).toLocaleDateString()}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
