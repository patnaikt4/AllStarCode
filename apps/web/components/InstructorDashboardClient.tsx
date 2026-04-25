'use client'

import Link from 'next/link'
import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { useRouter } from 'next/navigation'

export type InstructorUploadRow = {
  fileId: string
  fileName: string
  sourceStoragePath: string
  uploadedAt: string | null
  sourceType: 'pdf' | 'video'
  feedbackStatus:
    | 'ready'
    | 'not_started'
    | 'uploaded'
    | 'transcribing'
    | 'generating'
    | 'failed'
  feedbackId: number | null
  errorMessage?: string | null
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
  status?: 'uploaded' | 'transcribing' | 'generating' | 'complete' | 'failed'
  error?: string
}

type UploadResponse = {
  success?: boolean
  fileId?: string
  fileName?: string
  storagePath?: string
  maxDurationSeconds?: number
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

function getStatusLabel(row: InstructorUploadRow, isGenerating: boolean) {
  if (isGenerating && row.sourceType === 'pdf') {
    return 'Generating feedback...'
  }

  switch (row.feedbackStatus) {
    case 'uploaded':
      return 'Uploaded...'
    case 'transcribing':
      return 'Transcribing audio...'
    case 'generating':
      return 'Generating feedback...'
    case 'ready':
      return 'Feedback ready'
    case 'failed':
      return 'Processing failed'
    default:
      return 'Feedback not generated'
  }
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
  const pdfInputRef = useRef<HTMLInputElement>(null)
  const videoInputRef = useRef<HTMLInputElement>(null)
  const [rows, setRows] = useState(initialRows)
  const [uploadError, setUploadError] = useState<string | null>(initialLoadError)
  const [generateError, setGenerateError] = useState<string | null>(null)
  const [isUploading, setIsUploading] = useState(false)
  const [generatingLessonPlanId, setGeneratingLessonPlanId] = useState<string | null>(null)

  const readyCount = rows.filter((row) => row.feedbackStatus === 'ready').length

  async function handlePdfUpload(event: ChangeEvent<HTMLInputElement>) {
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
          sourceType: 'pdf',
          feedbackStatus: 'not_started',
          feedbackId: null,
          errorMessage: null,
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

  async function handleVideoUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]

    if (!file) {
      return
    }

    setUploadError(null)
    setGenerateError(null)

    if (!file.type.startsWith('video/')) {
      setUploadError('Please choose a video file.')
      event.target.value = ''
      return
    }

    const formData = new FormData()
    formData.append('file', file)

    try {
      setIsUploading(true)

      const response = await fetch('/api/uploads/video', {
        method: 'POST',
        body: formData,
      })

      const payload = await getResponsePayload<UploadResponse>(response)

      if (!response.ok || !payload.fileId || !payload.fileName || !payload.storagePath) {
        if (payload.maxDurationSeconds) {
          const minutes = Math.floor(payload.maxDurationSeconds / 60)
          throw new Error(
            `Video exceeds your admin's limit of ${minutes} minute${minutes === 1 ? '' : 's'}.`
          )
        }

        throw new Error(payload.error ?? 'Video upload failed. Please try again.')
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
          sourceType: 'video',
          feedbackStatus: 'not_started',
          feedbackId: null,
          errorMessage: null,
        },
        ...currentRows,
      ])

      router.refresh()
    } catch (error) {
      setUploadError(
        getErrorMessage(error, 'The video could not be uploaded. Please try again.')
      )
    } finally {
      setIsUploading(false)
      event.target.value = ''
    }
  }

  async function handleGenerateFeedback(row: InstructorUploadRow) {
    setGenerateError(null)
    setUploadError(null)

    try {
      setGeneratingLessonPlanId(row.fileId)

      const requestBody =
        row.sourceType === 'video'
          ? {
              instructorId,
              lessonPlanId: row.fileId,
              source_type: 'video',
              videoFileId: row.fileId,
            }
          : {
              instructorId,
              lessonPlanId: row.fileId,
              originalFilename: row.fileName,
            }

      const response = await fetch('/api/feedback/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      })

      const payload = await getResponsePayload<GenerateResponse>(response)

      if (!response.ok || !payload.success || !payload.feedbackId) {
        throw new Error(payload.error ?? 'Feedback generation failed. Please try again.')
      }

      setRows((currentRows) =>
        currentRows.map((currentRow) =>
          currentRow.fileId === row.fileId
            ? {
                ...currentRow,
                feedbackId: payload.feedbackId!,
                feedbackStatus:
                  row.sourceType === 'video'
                    ? payload.status === 'complete'
                      ? 'ready'
                      : (payload.status ?? 'uploaded')
                    : 'ready',
                errorMessage: null,
              }
            : currentRow
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

  useEffect(() => {
    const hasActiveVideoJob = rows.some(
      (row) =>
        row.sourceType === 'video' &&
        ['uploaded', 'transcribing', 'generating'].includes(row.feedbackStatus)
    )

    if (!hasActiveVideoJob) {
      return
    }

    const interval = window.setInterval(async () => {
      try {
        const response = await fetch(`/api/feedback/user/${instructorId}`)
        if (!response.ok) {
          return
        }

        const payload = await getResponsePayload<
          Array<{
            id: number
            status: 'uploaded' | 'transcribing' | 'generating' | 'complete' | 'failed'
            source_type?: 'pdf' | 'video'
            error_message?: string | null
          }>
        >(response)

        setRows((currentRows) =>
          currentRows.map((row) => {
            if (row.sourceType !== 'video' || !row.feedbackId) {
              return row
            }

            const match = payload.find((item) => item.id === row.feedbackId)
            if (!match) {
              return row
            }

            return {
              ...row,
              feedbackStatus: match.status === 'complete' ? 'ready' : match.status,
              errorMessage: match.error_message ?? null,
            }
          })
        )
      } catch {
        // ignore transient polling failures
      }
    }, 2500)

    return () => window.clearInterval(interval)
  }, [rows, instructorId])

  return (
    <section className="dashboard-panel">
      <div className="dashboard-panel-header">
        <div>
          <h2>Your uploads</h2>
          <p>
            {rows.length === 0
              ? 'Upload your first lesson plan PDF or lesson video to start generating feedback.'
              : `${readyCount} of ${rows.length} uploads have generated feedback ready to open.`}
          </p>
        </div>

        <div className="dashboard-upload-actions">
          <input
            ref={pdfInputRef}
            className="dashboard-file-input"
            type="file"
            accept="application/pdf"
            onChange={handlePdfUpload}
            disabled={isUploading}
          />
          <input
            ref={videoInputRef}
            className="dashboard-file-input"
            type="file"
            accept="video/*"
            onChange={handleVideoUpload}
            disabled={isUploading}
          />
          <button
            type="button"
            className="dashboard-primary-button"
            onClick={() => videoInputRef.current?.click()}
            disabled={isUploading}
          >
            {isUploading ? 'Uploading...' : 'Upload lesson video'}
          </button>
          <button
            type="button"
            className="dashboard-primary-button"
            onClick={() => pdfInputRef.current?.click()}
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
            Start with a lesson plan PDF or lesson video. Once it uploads, you can generate
            feedback and open the feedback file from this table when it is ready.
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
                const isVideoInProgress =
                  row.sourceType === 'video' &&
                  ['uploaded', 'transcribing', 'generating'].includes(row.feedbackStatus)

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
                          row.feedbackStatus === 'failed'
                            ? 'failed'
                            : isGenerating || isVideoInProgress
                              ? 'pending'
                              : isReady
                                ? 'ready'
                                : 'not-started'
                        }`}
                      >
                        {getStatusLabel(row, isGenerating)}
                      </span>
                    </td>
                    <td>
                      <div className="dashboard-row-actions">
                        <button
                          type="button"
                          className="dashboard-secondary-button"
                          onClick={() => handleGenerateFeedback(row)}
                          disabled={isGenerating || isVideoInProgress}
                        >
                          {isGenerating || isVideoInProgress
                            ? 'Processing...'
                            : isReady
                              ? 'Regenerate feedback'
                              : 'Generate feedback'}
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

                      {row.feedbackStatus === 'failed' && row.errorMessage ? (
                        <p className="dashboard-alert error">{row.errorMessage}</p>
                      ) : null}
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