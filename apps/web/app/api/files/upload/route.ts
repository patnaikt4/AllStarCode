import { createClient } from '@/lib/supabase/server'

export async function POST(request: Request) {
  const supabase = await createClient()

  // only logged-in users can upload
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return new Response('unauthorized', { status: 401 })

  const form = await request.formData()
  const file = form.get('file') as File | null

  // basic validation
  if (!file || file.size === 0) return new Response('file is required', { status: 400 })
  if (file.type !== 'application/pdf') return new Response('file must be a pdf', { status: 400 })

  // check pdf magic bytes (%PDF) so we're not trusting content-type alone
  const magic = new Uint8Array(await file.slice(0, 4).arrayBuffer())
  if (magic[0] !== 0x25 || magic[1] !== 0x50 || magic[2] !== 0x44 || magic[3] !== 0x46) {
    return new Response('file is not a valid pdf', { status: 400 })
  }

  const fileId = crypto.randomUUID()
  const storagePath = `${user.id}/${fileId}.pdf`

  // upload to storage bucket
  const { error: uploadError } = await supabase.storage
    .from('documents')
    .upload(storagePath, file, { contentType: 'application/pdf' })

  if (uploadError) {
    console.error('storage upload failed:', uploadError)
    return new Response('upload failed', { status: 500 })
  }

  // record in db — if this fails, clean up the orphaned file in storage
  const { error: dbError } = await supabase.from('files').insert({
    file_id: fileId,
    user_id: user.id,
    storage_path: storagePath,
    original_name: file.name,
    content_type: file.type,
  })

  if (dbError) {
    console.error('db insert failed:', dbError)
    await supabase.storage.from('documents').remove([storagePath])
    return new Response('database error', { status: 500 })
  }

  return Response.json({ file_id: fileId }, { status: 201 })
}
