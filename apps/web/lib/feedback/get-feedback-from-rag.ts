import OpenAI from 'openai'

import {
  retrieveCurriculumContext,
  stripInvalidUtf16Scalars,
} from '@/lib/rag/retrieve-curriculum-context'

const DEFAULT_FEEDBACK_MODEL = process.env.OPENAI_FEEDBACK_MODEL ?? 'gpt-5-mini'
/** Enough for assessment + 4–6 detailed bullets + revisions (900 was truncating mid-list). */
const DEFAULT_MAX_OUTPUT_TOKENS = 4096

function getMaxOutputTokens(): number {
  const raw = process.env.OPENAI_FEEDBACK_MAX_OUTPUT_TOKENS?.trim()
  if (!raw) {
    return DEFAULT_MAX_OUTPUT_TOKENS
  }
  const n = Number.parseInt(raw, 10)
  if (!Number.isFinite(n) || n < 1) {
    return DEFAULT_MAX_OUTPUT_TOKENS
  }
  return Math.min(n, 16_000)
}

export type FeedbackSource = 'written_lesson_plan' | 'video_transcript'

const FEEDBACK_SYSTEM_PROMPT = `You are an instructional coach reviewing lesson plans for alignment with the AllStarCode curriculum.

Your job is to give concrete, constructive feedback that helps an instructor improve the lesson plan.

Prioritize:
- alignment with learning objectives and curriculum expectations
- clarity of instructions and student outcomes
- pacing and sequencing
- inclusivity, accessibility, and student engagement
- actionable revisions the instructor can make next

Keep the tone supportive, specific, and practical.

Be succinct: prefer tight bullets over long prose. State the insight and one concrete fix per bullet; avoid repeating the lesson plan back. Skip lengthy quoted examples unless a single short phrase illustrates the point.`

const VIDEO_FEEDBACK_SYSTEM_PROMPT = `You are an instructional coach reviewing a teaching session recorded by an AllStarCode instructor.

You have access to a timestamped transcript of what was said, and when available: computer vision metrics about the instructor's physical presence, and a screen recording timeline describing what was visible on screen at each moment.

Your job is to give concrete, constructive feedback that helps the instructor improve their delivery and content alignment.

Prioritize:
- alignment with AllStarCode learning objectives and curriculum expectations
- clarity of verbal explanations and instructions given to students
- pacing, sequencing, and transitions throughout the session
- student engagement and participation cues
- physical presence and delivery energy when CV data is available
- screen/speech alignment: flag moments where the instructor explains a concept verbally but does not show a corresponding example, demo, or visual on screen — and moments where the screen content is blank, idle, or unrelated to what is being taught
- actionable changes the instructor can apply in the next session

Keep the tone supportive, specific, and practical.

Be succinct: prefer tight bullets over long prose. State the insight and one concrete fix per bullet. Skip lengthy quoted examples unless a single short phrase illustrates the point.`

function buildFeedbackPrompt({
  curriculumContext,
  lessonPlanText,
  source = 'written_lesson_plan',
  cvMetrics,
  screenTimeline,
}: {
  curriculumContext: string
  lessonPlanText: string
  source?: FeedbackSource
  cvMetrics?: string
  screenTimeline?: string
}) {
  const isVideo = source === 'video_transcript'
  const contentLabel = isVideo ? 'video transcript' : 'lesson plan'
  const contentHeader = isVideo ? 'Timestamped video transcript' : 'Lesson plan text'

  const hasCurriculumContext = curriculumContext && curriculumContext !== '[Placeholder: curriculum context]'

  const curriculumSection = hasCurriculumContext
    ? `Curriculum context:\n${curriculumContext}\n\n`
    : ''

  const cvSection = isVideo && cvMetrics ? `${cvMetrics}\n\n` : ''

  const screenSection = isVideo && screenTimeline
    ? `${screenTimeline}\n\nWhen giving feedback, cross-reference the screen timeline above with the transcript timestamps. Flag specific moments where the instructor explains a concept verbally but is not demonstrating it on screen, and moments where the screen is blank or idle while teaching is occurring.\n\n`
    : ''

  const screenInstruction =
    isVideo && screenTimeline
      ? `\n${cvMetrics ? (hasCurriculumContext ? '7' : '6') : hasCurriculumContext ? '6' : '5'}. Screen/speech alignment: identify moments where what is being said does not match what is shown on screen (e.g. explaining variables but showing a blank editor)`
      : ''

  const cvInstruction =
    isVideo && cvMetrics
      ? `\n${hasCurriculumContext ? '6' : '5'}. Physical presence and on-camera engagement based on the CV data above`
      : ''

  const curriculumInstruction = hasCurriculumContext
    ? `Your feedback must be grounded in the AllStarCode curriculum context provided below. Focus on:
1. Which AllStarCode topics this ${contentLabel} covers, partially covers, or misses entirely
2. Where the ${contentLabel}'s approach, vocabulary, or activities diverge from AllStarCode's curriculum
3. Specific changes to better align with AllStarCode's content and teaching expectations
4. Clarity of ${isVideo ? 'spoken explanations, pacing, and student engagement' : 'directions, pacing, and student engagement'} relative to AllStarCode's style
5. Concrete next steps to bring the ${isVideo ? 'session' : 'lesson'} into closer alignment${cvInstruction}${screenInstruction}`
    : `No curriculum context is available. Give general instructional coaching feedback on this ${contentLabel}. Focus on:
1. Clarity of learning objectives and student outcomes
2. ${isVideo ? 'Pacing, verbal clarity, and student engagement cues' : 'Pacing, sequencing, and student engagement'}
3. Instructional design quality and accessibility
4. Concrete improvements the instructor can make next${cvInstruction}${screenInstruction}`

  return `
Review this ${contentLabel} and provide instructional coaching feedback.

${curriculumInstruction}

Return:
- A brief overall assessment (a short paragraph, not an essay)
- 4 to 6 actionable feedback bullets: each bullet = one line title or bold lead, then at most 2–3 short sentences or sub-bullets—no multi-paragraph items
- A short "Suggested revisions" section (3–5 tight bullets for next steps)

Style: succinct throughout. Get to recommendations quickly.

${cvSection}${screenSection}${curriculumSection}${contentHeader}:
${lessonPlanText}
`.trim()
}

export async function getFeedbackFromRag(
  extractedLessonPlanText: string,
  options?: { source?: FeedbackSource; cvMetrics?: string; screenTimeline?: string }
): Promise<string> {
  const source = options?.source ?? 'written_lesson_plan'
  const cvMetrics = options?.cvMetrics
  const screenTimeline = options?.screenTimeline
  const lessonPlanText = stripInvalidUtf16Scalars(extractedLessonPlanText).trim()

  if (!lessonPlanText) {
    throw new Error('Cannot generate feedback from empty lesson plan text.')
  }

  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not configured.')
  }

  const curriculumContext = await retrieveCurriculumContext(lessonPlanText)
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  const systemPrompt = source === 'video_transcript' ? VIDEO_FEEDBACK_SYSTEM_PROMPT : FEEDBACK_SYSTEM_PROMPT

  const response = await client.responses.create({
    model: DEFAULT_FEEDBACK_MODEL,
    instructions: systemPrompt,
    input: buildFeedbackPrompt({
      curriculumContext,
      lessonPlanText,
      source,
      cvMetrics,
      screenTimeline,
    }),
    max_output_tokens: getMaxOutputTokens(),
  })

  const feedback = response.output_text.trim()

  if (!feedback) {
    throw new Error('OpenAI returned empty feedback.')
  }

  return feedback
}
