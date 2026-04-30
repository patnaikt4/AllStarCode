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

function buildFeedbackPrompt({
  curriculumContext,
  lessonPlanText,
}: {
  curriculumContext: string
  lessonPlanText: string
}) {
  return `
Review this lesson plan against the AllStarCode curriculum context provided below.

If the curriculum context is placeholder text or empty, respond only with a brief message stating that this lesson plan does not appear to cover topics from the AllStarCode CS curriculum, and cannot be reviewed.

If curriculum context is provided, your feedback must be grounded in that specific AllStarCode curriculum. Focus on:
1. Which AllStarCode topics this lesson plan covers, partially covers, or misses entirely
2. Where the lesson plan's approach, vocabulary, or activities diverge from AllStarCode's curriculum
3. Specific changes to better align with AllStarCode's content and teaching expectations
4. Clarity of directions, pacing, and student engagement relative to AllStarCode's style
5. Concrete next steps to bring the lesson into closer alignment

Do not give generic CS teaching advice. All feedback must reference what AllStarCode's curriculum actually covers.

Return:
- A brief overall assessment (a short paragraph, not an essay)
- 4 to 6 actionable feedback bullets: each bullet = one line title or bold lead, then at most 2–3 short sentences or sub-bullets—no multi-paragraph items
- A short "Suggested revisions" section (3–5 tight bullets for next steps)

Style: succinct throughout. Do not pad with restating syllabus content; get to recommendations quickly.

Curriculum context:
${curriculumContext}

Lesson plan text:
${lessonPlanText}
`.trim()
}

export async function getFeedbackFromRag(
  extractedLessonPlanText: string
): Promise<string> {
  const lessonPlanText = stripInvalidUtf16Scalars(extractedLessonPlanText).trim()

  if (!lessonPlanText) {
    throw new Error('Cannot generate feedback from empty lesson plan text.')
  }

  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not configured.')
  }

  const curriculumContext = await retrieveCurriculumContext(lessonPlanText)
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

  const response = await client.responses.create({
    model: DEFAULT_FEEDBACK_MODEL,
    instructions: FEEDBACK_SYSTEM_PROMPT,
    input: buildFeedbackPrompt({
      curriculumContext,
      lessonPlanText,
    }),
    max_output_tokens: getMaxOutputTokens(),
  })

  const feedback = response.output_text.trim()

  if (!feedback) {
    throw new Error('OpenAI returned empty feedback.')
  }

  return feedback
}
