import { createClient } from '@/lib/supabase/server'

const DOCUMENTS_BUCKET = 'documents'
const VIDEOS_BUCKET = 'videos'

function isValidUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ fileId: string }> }
) {
  try {
    const { fileId } = await params

    if (!fileId || !isValidUuid(fileId)) {
      return Response.json({ error: 'Invalid fileId.' }, { status: 400 })
    }

    const supabase = await createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return Response.json({ error: 'Unauthorized.' }, { status: 401 })
    }

    // Try the files table first (PDFs)
    const { data: fileRow, error: fetchError } = await supabase
      .from('files')
      .select('file_id, user_id, storage_path, content_type')
      .eq('file_id', fileId)
      .eq('user_id', user.id)
      .maybeSingle()

    if (fetchError) {
      return Response.json({ error: 'Failed to look up file.' }, { status: 500 })
    }

    if (fileRow) {
      const isVideo = fileRow.content_type?.startsWith('video/')
      const bucket = isVideo ? VIDEOS_BUCKET : DOCUMENTS_BUCKET

      await supabase.storage.from(bucket).remove([fileRow.storage_path])

      // Delete associated feedback records
      await supabase
        .from('feedback')
        .delete()
        .eq('lesson_plan_id', fileId)
        .eq('user_id', user.id)

      const { error: deleteError } = await supabase
        .from('files')
        .delete()
        .eq('file_id', fileId)
        .eq('user_id', user.id)

      if (deleteError) {
        return Response.json({ error: 'Failed to delete file record.' }, { status: 500 })
      }

      return Response.json({ success: true }, { status: 200 })
    }

    // Not in files table — check the videos bucket (videos are stored directly there)
    const { data: listedFiles, error: listError } = await supabase.storage
      .from(VIDEOS_BUCKET)
      .list(user.id, { search: fileId })

    if (listError) {
      return Response.json({ error: 'Failed to look up video file.' }, { status: 500 })
    }

    const videoObject = listedFiles?.find((f) => f.name.startsWith(fileId))

    if (!videoObject) {
      return Response.json({ error: 'File not found.' }, { status: 404 })
    }

    const storagePath = `${user.id}/${videoObject.name}`
    await supabase.storage.from(VIDEOS_BUCKET).remove([storagePath])

    // Delete associated feedback records so the row doesn't reappear on refresh
    await supabase
      .from('feedback')
      .delete()
      .eq('lesson_plan_id', fileId)
      .eq('user_id', user.id)

    return Response.json({ success: true }, { status: 200 })
  } catch (error) {
    console.error('DELETE /api/files/[fileId]:', error)
    return Response.json({ error: 'Internal server error.' }, { status: 500 })
  }
}
