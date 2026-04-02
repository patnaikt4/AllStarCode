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
const PLACEHOLDER_CURRICULUM_CONTEXT = '[Placeholder: curriculum context]'

const FEEDBACK_SYSTEM_PROMPT = `You are an instructional coach reviewing lesson plans for alignment with the AllStarCode curriculum.

Your job is to give concrete, constructive feedback that helps an instructor improve the lesson plan.

Prioritize:
- alignment with learning objectives and curriculum expectations
- clarity of instructions and student outcomes
- pacing and sequencing
- inclusivity, accessibility, and student engagement
- actionable revisions the instructor can make next

Keep the tone supportive, specific, and practical.`

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

  return await new Promise<string>((resolve) => {
    const child = spawn('python3', [scriptPath, '--k', String(k)], {
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

    child.stdin.write(extractedLessonPlanText)
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
Review this lesson plan and provide concrete written feedback on how to improve it according to the AllStarCode curriculum.

Use the curriculum context when it is relevant. If the curriculum context is limited or placeholder text, still provide a best-effort review grounded in the lesson plan itself.

Focus on:
1. Alignment to objectives and curriculum expectations
2. Clarity of directions, activities, and assessment
3. Pacing and sequencing
4. Inclusivity, accessibility, and student engagement
5. Specific revisions the instructor should make

Return:
- A brief overall assessment
- 4 to 6 actionable feedback bullets
- A short "Suggested revisions" section with the most important next steps

Curriculum context:
${curriculumContext}

Lesson plan text:
${lessonPlanText}
`.trim()
}

export async function getFeedbackFromRag(
  extractedLessonPlanText: string
): Promise<string> {
  const lessonPlanText = extractedLessonPlanText.trim()

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
    max_output_tokens: 900,
  })

  const feedback = response.output_text.trim()

  if (!feedback) {
    throw new Error('OpenAI returned empty feedback.')
  }

  return feedback
}
