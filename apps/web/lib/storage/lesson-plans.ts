// Server-only — Download a lesson plan PDF from Supabase Storage

import { createAdminClient } from '@/lib/supabase/admin'
import { LESSON_PLANS_BUCKET } from '@/lib/storage/constants'

export { LESSON_PLANS_BUCKET }

export class LessonPlanNotFoundError extends Error {
  readonly code = 'LESSON_PLAN_NOT_FOUND' as const
  constructor(lessonPlanId: string) {
    super(`Lesson plan not found: ${lessonPlanId}`)
    this.name = 'LessonPlanNotFoundError'
  }
}

export class LessonPlanStorageError extends Error {
  readonly code = 'LESSON_PLAN_STORAGE_ERROR' as const
  constructor(message: string, readonly cause?: unknown) {
    super(message)
    this.name = 'LessonPlanStorageError'
  }
}

/**
 * Fetch the PDF bytes for a lesson plan from Supabase Storage.
 *
 * Resolves the storage_path from the lesson_plans table, then downloads
 * the corresponding file from the 'lesson-plans' bucket.
 *
 * @param lessonPlanId  UUID of the lesson plan row
 * @returns             Raw PDF bytes as a Node.js Buffer
 * @throws              LessonPlanNotFoundError — row does not exist
 * @throws              LessonPlanStorageError  — DB or storage failure
 */
export async function getLessonPlanFile(lessonPlanId: string): Promise<Buffer> {
  const supabase = createAdminClient()

  // 1. Resolve the storage path from the DB row
  const { data: row, error: dbError } = await supabase
    .from('lesson_plans')
    .select('storage_path')
    .eq('id', lessonPlanId)
    .single()

  if (dbError || !row) {
    if (dbError?.code === 'PGRST116') {
      throw new LessonPlanNotFoundError(lessonPlanId)
    }
    throw new LessonPlanStorageError(
      `Failed to fetch lesson plan record: ${dbError?.message ?? 'unknown error'}`,
      dbError
    )
  }

  // 2. Download the file from Supabase Storage
  const { data: blob, error: storageError } = await supabase.storage
    .from(LESSON_PLANS_BUCKET)
    .download(row.storage_path)

  if (storageError || !blob) {
    throw new LessonPlanStorageError(
      `Failed to download lesson plan file (path: ${row.storage_path}): ${storageError?.message ?? 'no data returned'}`,
      storageError
    )
  }

  // Convert Blob → Buffer (Node.js)
  const arrayBuffer = await blob.arrayBuffer()
  return Buffer.from(arrayBuffer)
}
