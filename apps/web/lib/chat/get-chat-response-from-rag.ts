import OpenAI from 'openai'

import {
  retrieveCurriculumContext,
  stripInvalidUtf16Scalars,
} from '@/lib/rag/retrieve-curriculum-context'

const DEFAULT_CHAT_MODEL =
  process.env.OPENAI_CHAT_MODEL ?? process.env.OPENAI_FEEDBACK_MODEL ?? 'gpt-4o-mini'
const DEFAULT_MAX_OUTPUT_TOKENS = 2048

export type ChatHistoryTurn = {
  role: 'user' | 'assistant'
  content: string
}

const CHAT_SYSTEM_PROMPT = `You are an instructional assistant for AllStarCode instructors.

Your job is to answer instructor questions using the retrieved AllStarCode curriculum context as the source of truth.

Guidelines:
- Ground answers in the provided curriculum context whenever it is relevant.
- Be practical and classroom-facing: suggest lesson moves, explanations, checks for understanding, examples, and pacing tips.
- If the context does not contain enough information, say what is missing and offer a cautious, general teaching suggestion.
- When a lesson plan is provided, give specific, actionable feedback on how to modify it to better align with AllStarCode curriculum and pedagogy.
- Keep answers concise, supportive, and easy to act on.

Guardrails:
- Never use profanity, offensive language, or inappropriate content under any circumstances.
- You are strictly scoped to computer science education, coding, and teaching pedagogy. If a message is off-topic (e.g. personal advice, politics, entertainment, unrelated facts), do not answer it directly. Instead, briefly acknowledge the message, explain that you are focused on CS education and AllStarCode curriculum, and invite the instructor to ask a relevant question.
- Do not engage with harmful, discriminatory, or disrespectful content. Respond with a calm, professional redirect.`

function getMaxOutputTokens(): number {
  const raw = process.env.OPENAI_CHAT_MAX_OUTPUT_TOKENS?.trim()
  if (!raw) return DEFAULT_MAX_OUTPUT_TOKENS
  const n = Number.parseInt(raw, 10)
  if (!Number.isFinite(n) || n < 1) return DEFAULT_MAX_OUTPUT_TOKENS
  return Math.min(n, 16_000)
}

function formatHistory(history: ChatHistoryTurn[]) {
  if (history.length === 0) return 'No prior turns.'
  return history
    .map((turn) => {
      const speaker = turn.role === 'user' ? 'Instructor' : 'Assistant'
      return `${speaker}: ${turn.content.trim()}`
    })
    .join('\n\n')
}

function buildChatPrompt({
  curriculumContext,
  lessonPlanText,
  history,
  userMessage,
}: {
  curriculumContext: string
  lessonPlanText?: string
  history: ChatHistoryTurn[]
  userMessage: string
}) {
  const lessonPlanSection = lessonPlanText
    ? `\nInstructor's lesson plan (use this as the primary subject of your feedback and suggestions):\n${lessonPlanText}\n`
    : ''

  const lessonPlanInstruction = lessonPlanText
    ? 'When a lesson plan is provided, ground your feedback directly in that plan and suggest specific, actionable edits to align it with AllStarCode curriculum and pedagogy.\n\n'
    : ''

  return `
Answer the instructor's message using the AllStarCode curriculum context below.
${lessonPlanSection}
${lessonPlanInstruction}If the curriculum context is placeholder text, empty, or not relevant to the message, be transparent that you could not find specific matching curriculum context. You may still give brief general teaching guidance, but clearly separate it from curriculum-grounded advice.

Curriculum context:
${curriculumContext}

Recent conversation:
${formatHistory(history)}

Current instructor message:
${userMessage}
`.trim()
}

export async function getChatResponseFromRag(params: {
  message: string
  history?: ChatHistoryTurn[]
  lessonPlanText?: string
}): Promise<string> {
  const userMessage = stripInvalidUtf16Scalars(params.message).trim()
  const lessonPlanText = params.lessonPlanText
    ? stripInvalidUtf16Scalars(params.lessonPlanText).trim()
    : undefined
  const history = (params.history ?? [])
    .map((turn) => ({
      role: turn.role,
      content: stripInvalidUtf16Scalars(turn.content).trim(),
    }))
    .filter((turn) => turn.content)

  if (!userMessage) {
    throw new Error('Cannot generate a chat response from an empty message.')
  }

  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not configured.')
  }

  const curriculumContext = await retrieveCurriculumContext(userMessage)
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

  const response = await client.responses.create({
    model: DEFAULT_CHAT_MODEL,
    instructions: CHAT_SYSTEM_PROMPT,
    input: buildChatPrompt({
      curriculumContext,
      lessonPlanText,
      history,
      userMessage,
    }),
    max_output_tokens: getMaxOutputTokens(),
  })

  const message = response.output_text.trim()

  if (!message) {
    throw new Error('OpenAI returned an empty chat response.')
  }

  return message
}
