/**
 * Supabase Storage bucket for feedback PDF bytes (upload + download).
 * Defaults to `documents` to match typical project setup; override with FEEDBACK_STORAGE_BUCKET.
 */
export function getFeedbackStorageBucket(): string {
  const v = process.env.FEEDBACK_STORAGE_BUCKET?.trim()
  return v || 'documents'
}
