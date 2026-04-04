import { createClient } from '@/lib/supabase/server'

const FEEDBACK_BUCKET = 'FeedbackforLessonPlans'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ feedback_id: string }> }
) {
  try {
    const { feedback_id } = await params

    // 1) Validate input
    if (!feedback_id) {
      return new Response('Invalid feedback_id', { status: 400 })
    }

    // 2) Create server-side Supabase client
    const supabase = await createClient()

    // 3) Query feedback row
    const { data: row, error: dbError } = await supabase
      .from('feedback')
      .select('storage_path')
      .eq('id', feedback_id)
      .single()

    if (dbError || !row) {
      return new Response('Feedback not found', { status: 404 })
    }

    if (!row.storage_path) {
      return new Response('Feedback PDF path not found', { status: 404 })
    }

    // 4) Download PDF from storage
    const { data: fileData, error: storageError } = await supabase
      .storage
      .from(FEEDBACK_BUCKET)
      .download(row.storage_path)

    if (storageError || !fileData) {
      return new Response('Feedback PDF not found', { status: 404 })
    }

    // 5) Convert blob/file to array buffer
    const arrayBuffer = await fileData.arrayBuffer()

    // 6) Return PDF response
    return new Response(arrayBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="feedback-${feedback_id}.pdf"`,
      },
    })
  } catch (error) {
    console.error('Error in GET /feedback/[feedback_id]:', error)
    return new Response('Internal server error', { status: 500 })
  }
}
