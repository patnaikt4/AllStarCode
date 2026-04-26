import { spawn } from 'node:child_process'
import { access } from 'node:fs/promises'
import path from 'node:path'

export type SimilarChunk = {
  chunk_text?: unknown
  metadata?: unknown
  similarity?: unknown
}

export const DEFAULT_RETRIEVAL_COUNT = 3
export const PLACEHOLDER_CURRICULUM_CONTEXT = '[Placeholder: curriculum context]'

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

/** Strip lone UTF-16 surrogates so strings are valid UTF-8 for Python stdin and APIs. */
export function stripInvalidUtf16Scalars(s: string): string {
  return s.replace(
    /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/gu,
    ''
  )
}

export function formatCurriculumContext(chunks: SimilarChunk[]) {
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

export async function retrieveCurriculumContext(
  queryText: string,
  k = DEFAULT_RETRIEVAL_COUNT
) {
  const scriptPath = await resolveSimilaritySearchScriptPath()

  if (!scriptPath) {
    return PLACEHOLDER_CURRICULUM_CONTEXT
  }

  const sanitizedQueryText = stripInvalidUtf16Scalars(queryText).trim()

  if (!sanitizedQueryText) {
    return PLACEHOLDER_CURRICULUM_CONTEXT
  }

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

    child.stdin.write(sanitizedQueryText, 'utf8')
    child.stdin.end()
  })
}
