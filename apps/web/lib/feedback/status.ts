export const FEEDBACK_STATUSES = [
  'uploaded',
  'transcribing',
  'generating',
  'complete',
  'failed',
] as const

export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number]

export const SOURCE_TYPES = ['pdf', 'video'] as const

export type SourceType = (typeof SOURCE_TYPES)[number]
