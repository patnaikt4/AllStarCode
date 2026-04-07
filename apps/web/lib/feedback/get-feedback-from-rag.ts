import { spawn } from 'node:child_process'
import { access } from 'node:fs/promises'
import path from 'node:path'

import OpenAI from 'openai'

type SimilarChunk = {
  chunk_text?: unknown
  metadata?: unknown
  similarity?: unknown
}

const DEFAULT_RETRIEVAL_COUNT = 3
const DEFAULT_FEEDBACK_MODEL = process.env.OPENAI_FEEDBACK_MODEL ?? 'gpt-5-mini'
/** Enough for assessment + 4–6 detailed bullets + revisions (900 was truncating mid-list). */
const DEFAULT_MAX_OUTPUT_TOKENS = 4096
const PLACEHOLDER_CURRICULUM_CONTEXT = '[Placeholder: curriculum context]'

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

/** Strip lone UTF-16 surrogates so strings are valid UTF-8 for Python stdin and APIs. */
function stripInvalidUtf16Scalars(s: string): string {
  return s.replace(
    /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/gu,
    ''
  )
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

function toErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) {
    return error.message
  }

  return 'Unknown error'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function getMetadataLabel(metadata: unknown) {
  if (!isRecord(metadata)) {
    return null
  }

  const candidates = ['source', 'doc_name', 'title', 'file_name']

  for (const key of candidates) {
    const value = metadata[key]

    if (typeof value === 'string' && value.trim()) {
      return value.trim()
    }
  }

  return null
}

function formatCurriculumContext(chunks: SimilarChunk[]) {
  const formattedChunks = chunks
    .map((chunk, index) => {
      if (typeof chunk.chunk_text !== 'string' || !chunk.chunk_text.trim()) {
        return null
      }

      const label = getMetadataLabel(chunk.metadata)
      const similarity =
        typeof chunk.similarity === 'number'
          ? ` | similarity: ${chunk.similarity.toFixed(3)}`
          : ''

      return [
        `Chunk ${index + 1}${label ? ` | source: ${label}` : ''}${similarity}`,
        chunk.chunk_text.trim(),
      ].join('\n')
    })
    .filter((chunk): chunk is string => Boolean(chunk))

  if (formattedChunks.length === 0) {
    return PLACEHOLDER_CURRICULUM_CONTEXT
  }

  return formattedChunks.join('\n\n')
}

function parseSimilaritySearchOutput(stdout: string): SimilarChunk[] {
  const parsed: unknown = JSON.parse(stdout)

  if (!Array.isArray(parsed)) {
    throw new Error('Similarity search returned a non-array response.')
  }

  return parsed
}

async function resolveSimilaritySearchScriptPath() {
  const candidatePaths = [
    path.resolve(process.cwd(), 'scripts', 'similarity_search.py'),
    path.resolve(process.cwd(), '..', 'scripts', 'similarity_search.py'),
    path.resolve(process.cwd(), '..', '..', 'scripts', 'similarity_search.py'),
  ]

  for (const candidatePath of candidatePaths) {
    try {
      await access(candidatePath)
      return candidatePath
    } catch {
      continue
    }
  }

  return null
}

async function retrieveCurriculumContext(
  extractedLessonPlanText: string,
  k = DEFAULT_RETRIEVAL_COUNT
) {
  const scriptPath = await resolveSimilaritySearchScriptPath()

  if (!scriptPath) {
    return PLACEHOLDER_CURRICULUM_CONTEXT
  }

  const queryText = stripInvalidUtf16Scalars(extractedLessonPlanText)

  return await new Promise<string>((resolve) => {
    const python = process.platform === 'win32' ? 'python' : 'python3'
    const child = spawn(python, [scriptPath, '--k', String(k)], {
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (chunk: Buffer | string) => {
      stdout += chunk.toString()
    })

    child.stderr.on('data', (chunk: Buffer | string) => {
      stderr += chunk.toString()
    })

    child.on('error', (error) => {
      console.warn(
        `Falling back to placeholder curriculum context: ${toErrorMessage(error)}`
      )
      resolve(PLACEHOLDER_CURRICULUM_CONTEXT)
    })

    child.on('close', (code) => {
      if (code !== 0) {
        const reason = stderr.trim() || `similarity search exited with code ${code}`
        console.warn(`Falling back to placeholder curriculum context: ${reason}`)
        resolve(PLACEHOLDER_CURRICULUM_CONTEXT)
        return
      }

      try {
        const chunks = parseSimilaritySearchOutput(stdout)
        resolve(formatCurriculumContext(chunks))
      } catch (error) {
        console.warn(
          `Falling back to placeholder curriculum context: ${toErrorMessage(error)}`
        )
        resolve(PLACEHOLDER_CURRICULUM_CONTEXT)
      }
    })

    child.stdin.write(queryText, 'utf8')
    child.stdin.end()
  })
}

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
