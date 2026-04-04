import { randomUUID } from 'node:crypto'

import { createClient } from '@/lib/supabase/server'

const LESSON_PLAN_BUCKET = 'documents'

function jsonResponse(body: Record<string, unknown>, status: number) {
  return Response.json(body, { status })
}

function sanitizeFileName(fileName: string) {
  return fileName
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-zA-Z0-9._-]/g, '')
    .toLowerCase()
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return jsonResponse(
        {
          success: false,
          error: 'You must be signed in to upload a lesson plan.',
        },
        401
      )
    }

    const formData = await request.formData()
    const file = formData.get('file')

    if (!(file instanceof File)) {
      return jsonResponse(
        {
          success: false,
          error: 'Please choose a PDF file to upload.',
        },
        400
      )
    }

    if (file.type !== 'application/pdf') {
      return jsonResponse(
        {
          success: false,
          error: 'Only PDF lesson plans are supported right now.',
        },
        400
      )
    }

    if (file.size === 0) {
      return jsonResponse(
        {
          success: false,
          error: 'The selected PDF is empty. Please choose a file with content.',
        },
        400
      )
    }

    const safeName = sanitizeFileName(file.name) || 'lesson-plan.pdf'
    const lessonPlanId = `${randomUUID()}__${safeName}`
    const storagePath = `${user.id}/${lessonPlanId}`

    const { error: uploadError } = await supabase.storage
      .from(LESSON_PLAN_BUCKET)
      .upload(storagePath, file, {
        contentType: 'application/pdf',
        upsert: false,
      })

    if (uploadError) {
      return jsonResponse(
        {
          success: false,
          error: `Upload failed: ${uploadError.message}`,
        },
        500
      )
    }

    const { data: fileRow, error: insertError } = await supabase
      .from('files')
      .insert({
        user_id: user.id,
        storage_path: storagePath,
        original_name: file.name,
        content_type: file.type,
      })
      .select('file_id')
      .single()

    if (insertError || !fileRow) {
      return jsonResponse(
        {
          success: false,
          error: `Upload saved to storage but file metadata could not be recorded: ${
            insertError?.message ?? 'unknown error'
          }`,
        },
        500
      )
    }

    return jsonResponse(
      {
        success: true,
        fileId: fileRow.file_id,
        fileName: file.name,
        storagePath,
      },
      200
    )
  } catch (error) {
    return jsonResponse(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : 'The lesson plan upload failed unexpectedly.',
      },
      500
    )
  }
}
