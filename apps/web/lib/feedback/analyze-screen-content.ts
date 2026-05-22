import OpenAI from 'openai'

import { type VideoFrame, formatTimestamp } from './extract-video-frames'

// Process frames in batches to stay within token limits.
// GPT-4o handles ~800 tokens per 960px image; 5 frames ≈ 4000 image tokens per batch.
const BATCH_SIZE = 5
const SCREEN_ANALYSIS_MODEL = 'gpt-4o'

const FRAME_ANALYSIS_PROMPT = `You are analyzing frames from an instructor's screen recording.
Each frame is labeled with a timestamp.

For each frame, provide a concise 1–2 sentence description focusing on:
1. What is displayed on screen (code editor, terminal, browser, presentation, blank/desktop, etc.)
2. The specific content visible — e.g. "JavaScript variable declaration: let x = 5", "Python loop iterating over a list", "Blank code editor", "Slide titled Introduction to Variables"

Be precise about code content when visible. If the screen is blank or shows a desktop, say so clearly.

Format your response exactly as:
[MM:SS] <description>
[MM:SS] <description>
...one line per frame, in timestamp order.`

export type ScreenTimeline = {
  entries: { timestampSeconds: number; description: string }[]
  formatted: string
}

function parseTimelineEntries(
  text: string,
  frames: VideoFrame[]
): { timestampSeconds: number; description: string }[] {
  const entries: { timestampSeconds: number; description: string }[] = []
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean)

  let frameIndex = 0

  for (const line of lines) {
    const match = line.match(/^\[(\d+):(\d+)\]\s+(.+)$/)
    if (match) {
      const minutes = parseInt(match[1], 10)
      const seconds = parseInt(match[2], 10)
      entries.push({
        timestampSeconds: minutes * 60 + seconds,
        description: match[3].trim(),
      })
    } else if (line && frameIndex < frames.length) {
      // Fallback: if the model didn't include a timestamp prefix, map by order
      entries.push({
        timestampSeconds: frames[frameIndex].timestampSeconds,
        description: line,
      })
    }
    frameIndex++
  }

  return entries
}

function buildBatchMessage(batch: VideoFrame[]): OpenAI.Chat.ChatCompletionMessageParam {
  const content: OpenAI.Chat.ChatCompletionContentPart[] = [
    {
      type: 'text',
      text:
        FRAME_ANALYSIS_PROMPT +
        '\n\nFrames to analyze:\n' +
        batch.map((f) => `[${formatTimestamp(f.timestampSeconds)}]`).join(', '),
    },
    ...batch.map(
      (frame): OpenAI.Chat.ChatCompletionContentPartImage => ({
        type: 'image_url',
        image_url: {
          url: `data:image/jpeg;base64,${frame.base64}`,
          detail: 'high',
        },
      })
    ),
  ]

  return { role: 'user', content }
}

export async function analyzeScreenContent(
  frames: VideoFrame[]
): Promise<ScreenTimeline | null> {
  if (frames.length === 0) return null

  if (!process.env.OPENAI_API_KEY) {
    console.warn('analyzeScreenContent: OPENAI_API_KEY not set, skipping.')
    return null
  }

  try {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
    const allEntries: { timestampSeconds: number; description: string }[] = []

    // Process in batches
    for (let i = 0; i < frames.length; i += BATCH_SIZE) {
      const batch = frames.slice(i, i + BATCH_SIZE)

      const response = await client.chat.completions.create({
        model: SCREEN_ANALYSIS_MODEL,
        messages: [buildBatchMessage(batch)],
        max_tokens: 1000,
        temperature: 0,
      })

      const text = response.choices[0]?.message?.content?.trim() ?? ''
      if (text) {
        allEntries.push(...parseTimelineEntries(text, batch))
      }
    }

    if (allEntries.length === 0) return null

    const formatted =
      'Screen recording timeline:\n' +
      allEntries
        .map((e) => `[${formatTimestamp(e.timestampSeconds)}] ${e.description}`)
        .join('\n')

    return { entries: allEntries, formatted }
  } catch (error) {
    console.warn(
      'analyzeScreenContent failed (non-fatal):',
      error instanceof Error ? error.message : String(error)
    )
    return null
  }
}

export function formatScreenTimeline(timeline: ScreenTimeline): string {
  return timeline.formatted
}
