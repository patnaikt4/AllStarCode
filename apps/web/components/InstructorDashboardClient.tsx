'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useRef, useState, type ChangeEvent } from 'react'

export type InstructorUploadRow = {
  fileId: string
  fileName: string
  sourceStoragePath: string
  uploadedAt: string | null
  feedbackStatus: 'ready' | 'not_started'
  feedbackId: number | null
}

type Props = {
  instructorId: string
  initialRows: InstructorUploadRow[]
  initialLoadError: string | null
}

type GenerateResponse = {
  success?: boolean
  feedbackId?: number
  fileId?: string
  error?: string
}

type UploadResponse = {
  success?: boolean
  fileId?: string
  fileName?: string
  storagePath?: string
  error?: string
}

function formatDate(value: string | null) {
  if (!value) {
    return 'Upload date unavailable'
  }

  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message.trim()) {
    return error.message
  }

  return fallback
}

async function getResponsePayload<T>(response: Response): Promise<T> {
  const contentType = response.headers.get('content-type') ?? ''

  if (contentType.includes('application/json')) {
    return (await response.json()) as T
  }

  const text = await response.text()
  throw new Error(text || `Request failed with status ${response.status}.`)
}

export default function InstructorDashboardClient({
  instructorId,
  initialRows,
  initialLoadError,
}: Props) {
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [rows, setRows] = useState(initialRows)
  const [uploadError, setUploadError] = useState<string | null>(initialLoadError)
  const [generateError, setGenerateError] = useState<string | null>(null)
  const [isUploading, setIsUploading] = useState(false)
  const [generatingLessonPlanId, setGeneratingLessonPlanId] = useState<string | null>(null)

  const readyCount = rows.filter((row) => row.feedbackStatus === 'ready').length

  async function handleUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]

    if (!file) {
      return
    }

    setUploadError(null)
    setGenerateError(null)

    if (file.type !== 'application/pdf') {
      setUploadError('Please upload a PDF lesson plan so feedback can be generated from it.')
      event.target.value = ''
      return
    }

    const formData = new FormData()
    formData.append('file', file)

    try {
      setIsUploading(true)

      const response = await fetch('/api/lesson-plans/upload', {
        method: 'POST',
        body: formData,
      })

      const payload = await getResponsePayload<UploadResponse>(response)

      if (
        !response.ok ||
        !payload.success ||
        !payload.fileId ||
        !payload.fileName ||
        !payload.storagePath
      ) {
        throw new Error(payload.error ?? 'Upload failed. Please try again.')
      }

      const fileId = payload.fileId
      const fileName = payload.fileName
      const storagePath = payload.storagePath

      setRows((currentRows) => [
        {
          fileId,
          fileName,
          sourceStoragePath: storagePath,
          uploadedAt: new Date().toISOString(),
          feedbackStatus: 'not_started',
          feedbackId: null,
        },
        ...currentRows,
      ])

      router.refresh()
    } catch (error) {
      setUploadError(
        getErrorMessage(error, 'The lesson plan could not be uploaded. Please try again.')
      )
    } finally {
      setIsUploading(false)
      event.target.value = ''
    }
  }

  async function handleGenerateFeedback(fileId: string) {
    setGenerateError(null)
    setUploadError(null)

    try {
      setGeneratingLessonPlanId(fileId)

      const response = await fetch('/api/feedback/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          instructorId,
          fileId,
        }),
      })

      const payload = await getResponsePayload<GenerateResponse>(response)

      if (!response.ok || !payload.success || !payload.feedbackId) {
        throw new Error(payload.error ?? 'Feedback generation failed. Please try again.')
      }

      setRows((currentRows) =>
        currentRows.map((row) =>
          row.fileId === fileId
            ? {
                ...row,
                feedbackStatus: 'ready',
                feedbackId: payload.feedbackId!,
              }
            : row
        )
      )

      router.refresh()
    } catch (error) {
      setGenerateError(
        getErrorMessage(error, 'Feedback could not be generated for that upload.')
      )
    } finally {
      setGeneratingLessonPlanId(null)
    }
  }

  return (
    <section className="dashboard-panel">
      <div className="dashboard-panel-header">
        <div>
          <h2>Your uploads</h2>
          <p>
            {rows.length === 0
              ? 'Upload your first lesson plan PDF to start generating feedback.'
              : `${readyCount} of ${rows.length} uploads have generated feedback ready to open.`}
          </p>
        </div>

        <div className="dashboard-upload-actions">
          <input
            ref={fileInputRef}
            className="dashboard-file-input"
            type="file"
            accept="application/pdf"
            onChange={handleUpload}
            disabled={isUploading}
          />
          <button
            type="button"
            className="dashboard-primary-button"
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploading}
          >
            {isUploading ? 'Uploading PDF...' : 'Upload lesson plan PDF'}
          </button>
        </div>
      </div>

      {uploadError ? <p className="dashboard-alert error">{uploadError}</p> : null}
      {generateError ? <p className="dashboard-alert error">{generateError}</p> : null}

      {rows.length === 0 ? (
        <div className="dashboard-empty-state">
          <h3>No uploads yet</h3>
          <p>
            Start with a lesson plan PDF. Once it uploads, you can generate written feedback and
            open the feedback PDF from this table.
          </p>
        </div>
      ) : (
        <div className="dashboard-table-wrap">
          <table className="dashboard-table">
            <thead>
              <tr>
                <th>File</th>
                <th>Uploaded</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const isGenerating = generatingLessonPlanId === row.fileId
                const isReady = row.feedbackStatus === 'ready' && !!row.feedbackId

                return (
                  <tr key={row.fileId}>
                    <td>
                      <div className="dashboard-file-cell">
                        <strong>{row.fileName}</strong>
                        <span>{row.sourceStoragePath}</span>
                      </div>
                    </td>
                    <td>{formatDate(row.uploadedAt)}</td>
                    <td>
                      <span
                        className={`dashboard-status-pill ${
                          isGenerating
                            ? 'pending'
                            : isReady
                              ? 'ready'
                              : 'not-started'
                        }`}
                      >
                        {isGenerating
                          ? 'Generating feedback...'
                          : isReady
                            ? 'Feedback ready'
                            : 'Feedback not generated'}
                      </span>
                    </td>
                    <td>
                      <div className="dashboard-row-actions">
                        <button
                          type="button"
                          className="dashboard-secondary-button"
                          onClick={() => handleGenerateFeedback(row.fileId)}
                          disabled={isGenerating}
                        >
                          {isGenerating ? 'Generating...' : isReady ? 'Regenerate feedback' : 'Generate feedback'}
                        </button>

                        {isReady ? (
                          <Link
                            className="dashboard-link-button"
                            href={`/feedback/${row.feedbackId}`}
                            target="_blank"
                          >
                            View feedback
                          </Link>
                        ) : (
                          <span className="dashboard-link-button disabled">View feedback</span>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
