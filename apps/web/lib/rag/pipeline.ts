// Server-only — RAG feedback generation pipeline
// Retrieves relevant All Star Code curriculum chunks from Supabase (pgvector),
// then calls OpenAI to produce structured, curriculum-grounded feedback.

import OpenAI from 'openai'
import { createAdminClient } from '@/lib/supabase/admin'

// ─── Prompt versioning ────────────────────────────────────────────────────────
// Bump this constant when prompts are edited so changes are traceable in logs.
export const PROMPT_VERSION = 'asc-v1'

// ─── Error class ──────────────────────────────────────────────────────────────
export class RagPipelineError extends Error {
  readonly code = 'RAG_PIPELINE_ERROR' as const
  constructor(message: string, readonly cause?: unknown) {
    super(message)
    this.name = 'RagPipelineError'
  }
}

// ─── Types ────────────────────────────────────────────────────────────────────
interface CurriculumChunk {
  id: string
  source_doc: string
  chunk_text: string
  metadata: Record<string, unknown>
  similarity: number
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getOpenAIClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    throw new RagPipelineError('Missing OPENAI_API_KEY environment variable')
  }
  return new OpenAI({ apiKey })
}

/**
 * Embed a text string using OpenAI text-embedding-ada-002 (1536 dimensions).
 * Matches the vector(1536) column in curriculum_chunks.
 */
async function embedText(text: string, client: OpenAI): Promise<number[]> {
  const response = await client.embeddings.create({
    model: 'text-embedding-ada-002',
    input: text.slice(0, 8000), // ada-002 context limit
  })
  return response.data[0].embedding
}

/**
 * Retrieve the top-k most relevant curriculum chunks for a given query embedding.
 * Returns an empty array if the table has no data or pgvector is not configured.
 */
async function retrieveChunks(
  queryEmbedding: number[],
  k = 5
): Promise<CurriculumChunk[]> {
  const supabase = createAdminClient()

  const { data, error } = await supabase.rpc('match_curriculum_chunks', {
    query_embedding: queryEmbedding,
    match_count: k,
    match_threshold: 0.5,
  })

  if (error) {
    // Treat retrieval errors as non-fatal: log and proceed with empty context.
    // The prompt still produces useful feedback from the lesson text alone.
    console.warn(
      `[rag/pipeline] curriculum retrieval failed (proceeding with empty context): ${error.message}`
    )
    return []
  }

  return (data as CurriculumChunk[]) ?? []
}

/**
 * Format retrieved curriculum chunks into a context block for the prompt.
 * Each chunk is presented with its source document and similarity score.
 */
function buildCurriculumContext(chunks: CurriculumChunk[]): string {
  if (chunks.length === 0) {
    return '(No curriculum reference material retrieved — feedback is based on All Star Code ' +
           'curriculum standards and best practices.)'
  }

  return chunks
    .map(
      (c, i) =>
        `[Chunk ${i + 1} — Source: ${c.source_doc}, similarity: ${(c.similarity * 100).toFixed(1)}%]\n` +
        c.chunk_text.trim()
    )
    .join('\n\n---\n\n')
}

// ─── Prompts ──────────────────────────────────────────────────────────────────

function buildSystemPrompt(curriculumContext: string): string {
  return `You are an expert curriculum coach for All Star Code, a nonprofit organization that teaches introductory computer science and coding skills to young men of color from underrepresented communities. You specialize in helping instructors create high-quality, equitable, and engaging coding lessons.

Your job is to review an instructor's lesson plan and provide specific, actionable feedback that is grounded in:
1. The All Star Code curriculum reference material excerpts provided below
2. All Star Code's core curriculum philosophy and standards

ALL STAR CODE CURRICULUM PHILOSOPHY:
• Project-based learning: students build real, working software — avoid purely abstract exercises
• Culturally responsive pedagogy: lessons should connect CS concepts to students' lived experiences, interests, and communities
• Equity and inclusion: every student can succeed; account for diverse backgrounds and prior knowledge
• Growth mindset: normalize struggle and debugging; celebrate persistence, not just correctness
• Collaborative learning: peer support, pair programming, and group problem-solving are core to the culture
• Clear, measurable learning objectives tied to coding milestones (e.g. "Students will write a function that...")
• Formative assessment: regular check-ins (exit tickets, code reviews, pair demos) to catch confusion early
• Pacing for diverse learners: build in buffer time, extension challenges, and scaffolded support

FEEDBACK STANDARDS:
• Quote or paraphrase specific lines from the lesson plan to support each observation
• Where curriculum reference material is available, cite the source_doc and relevant passage
• Every recommendation must be actionable: tell the instructor exactly what to change and why
• Prioritize feedback — label items as Critical / Important / Enhancement
• Keep the output to approximately 600–900 words so the PDF renders cleanly
• Use the exact output format specified in the user message (headings, numbered lists)

CURRICULUM REFERENCE MATERIAL:
${curriculumContext}`
}

function buildUserPrompt(lessonText: string): string {
  // Truncate very long lesson plans to ~6 000 chars to stay within context budget
  const truncated = lessonText.length > 6000
    ? lessonText.slice(0, 6000) + '\n\n[...lesson plan truncated for length...]'
    : lessonText

  return `Please review the following All Star Code lesson plan and return feedback using the exact format below.

LESSON PLAN:
${truncated}

---

Return your feedback in this exact format (PROMPT_VERSION: ${PROMPT_VERSION}):

## Lesson Plan Feedback Summary

**Lesson:** [lesson title or "Untitled" if not present]
**Reviewed by:** All Star Code AI Curriculum Coach
**Prompt version:** ${PROMPT_VERSION}

---

## 1. Overall Assessment
[2–3 sentences summarising the lesson plan's strengths and the most critical gaps.]

## 2. Learning Objectives Alignment
[Are objectives clear, measurable, and tied to All Star Code coding milestones? Reference specific lines from the lesson plan. Provide numbered recommendations labelled Critical / Important / Enhancement.]

## 3. Pacing & Structure
[Is the timing realistic for the target student population? Does the flow support diverse learners? Reference specific timings or sections. Provide numbered recommendations.]

## 4. Culturally Responsive Elements
[Does the lesson connect CS concepts to students' lived experiences and backgrounds? Cite evidence from the lesson plan. Provide numbered recommendations.]

## 5. Formative Assessment
[Are there sufficient checkpoints to gauge understanding (exit tickets, code demos, pair checks)? Provide numbered recommendations.]

## 6. Inclusivity & Differentiation
[Does the lesson include scaffolding for struggling students and extension challenges for advanced learners? Provide numbered recommendations.]

## 7. Priority Action Items
[Top 3–5 specific, high-impact changes the instructor should make before teaching this lesson. Number by priority (1 = most critical). Each item should be one sentence with a concrete action.]`
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Generate structured, curriculum-grounded feedback for an All Star Code lesson plan.
 *
 * Pipeline:
 *   1. Embed the lesson text (OpenAI ada-002)
 *   2. Retrieve similar curriculum chunks from Supabase pgvector
 *   3. Build system + user prompts with retrieved context
 *   4. Call GPT-4o to generate structured feedback
 *
 * @param lessonText  Plain text extracted from the lesson plan PDF
 * @returns           Structured feedback string in the format expected by generateFeedbackPdf
 * @throws            RagPipelineError on any unrecoverable failure
 */
export async function getFeedbackFromRag(lessonText: string): Promise<string> {
  const client = getOpenAIClient()

  // Step 1: embed the lesson text
  let queryEmbedding: number[]
  try {
    queryEmbedding = await embedText(lessonText, client)
  } catch (err) {
    throw new RagPipelineError(
      `Failed to generate embedding for lesson text: ${err instanceof Error ? err.message : String(err)}`,
      err
    )
  }

  // Step 2: retrieve relevant curriculum chunks (non-fatal if empty)
  const chunks = await retrieveChunks(queryEmbedding)
  const curriculumContext = buildCurriculumContext(chunks)

  console.log(
    `[rag/pipeline] retrieved ${chunks.length} curriculum chunk(s) for feedback generation`
  )

  // Step 3 + 4: build prompts and call the LLM
  const systemPrompt = buildSystemPrompt(curriculumContext)
  const userPrompt   = buildUserPrompt(lessonText)

  let completion: OpenAI.Chat.ChatCompletion
  try {
    completion = await client.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: userPrompt },
      ],
      temperature: 0.4,   // Lower temperature for consistent, structured output
      max_tokens: 1800,   // ~900 words with formatting tokens
    })
  } catch (err) {
    throw new RagPipelineError(
      `OpenAI completion request failed: ${err instanceof Error ? err.message : String(err)}`,
      err
    )
  }

  const feedback = completion.choices[0]?.message?.content?.trim()
  if (!feedback) {
    throw new RagPipelineError('OpenAI returned an empty completion')
  }

  return feedback
}
