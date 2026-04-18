import { createClient } from '@/lib/supabase/server'

const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_BYTES ?? 5 * 1024 * 1024)

function jsonError(status: number, code: string, message: string) {
  return Response.json({ error: { code, message } }, { status })
}

export async function POST(request: Request) {
  const supabase = await createClient()

  // only logged-in users can upload
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return jsonError(401, 'UNAUTHORIZED', 'unauthorized')

  const form = await request.formData()
  const files = form.getAll('file')
  const file = files[0] as File | null

  // basic validation
  if (files.length === 0 || !file) {
    return jsonError(400, 'MISSING_FILE', 'file is required')
  }

  if (files.length > 1) {
    return jsonError(400, 'MULTIPLE_FILES_NOT_ALLOWED', 'only one file is allowed')
  }

  if (file.size === 0) {
    return jsonError(400, 'EMPTY_FILE', 'file is required')
  }

  if (file.size > MAX_UPLOAD_BYTES) {
    return jsonError(413, 'FILE_TOO_LARGE', 'file is too large')
  }

  if (file.type !== 'application/pdf') {
    return jsonError(415, 'UNSUPPORTED_MEDIA_TYPE', 'file must be a pdf')
  }

  // check pdf magic bytes (%PDF) so we're not trusting content-type alone
  const magic = new Uint8Array(await file.slice(0, 5).arrayBuffer())
  if (
    magic[0] !== 0x25 ||
    magic[1] !== 0x50 ||
    magic[2] !== 0x44 ||
    magic[3] !== 0x46 ||
    magic[4] !== 0x2d
  ) {
    return jsonError(400, 'INVALID_PDF', 'file is not a valid pdf')
  }

  const fileId = crypto.randomUUID()
  const storagePath = `${user.id}/${fileId}.pdf`

  // upload to storage bucket
  const { error: uploadError } = await supabase.storage
    .from('documents')
    .upload(storagePath, file, { contentType: 'application/pdf' })

  if (uploadError) {
    console.error('storage upload failed:', uploadError)
    return jsonError(500, 'UPLOAD_FAILED', 'upload failed')
  }

  // record in db — if this fails, clean up the orphaned file in storage
  const { error: dbError } = await supabase.from('files').insert({
    file_id: fileId,
    user_id: user.id,
    storage_path: storagePath,
    original_name: file.name,
    content_type: file.type,
    status: 'uploaded',
  })

  if (dbError) {
    console.error('db insert failed:', dbError)
    await supabase.storage.from('documents').remove([storagePath])
    return jsonError(500, 'DATABASE_ERROR', 'database error')
  }

  return Response.json({ file_id: fileId }, { status: 201 })
}