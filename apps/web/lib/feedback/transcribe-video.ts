import fs from 'node:fs'
import { promises as fsp } from 'node:fs'
import { spawn } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

import OpenAI from 'openai'

export type TranscriptSegment = {
  start: number
  end: number
  text: string
}

export type TranscriptResult = {
  text: string
  segments: TranscriptSegment[]
}

function getFfmpegPath(): string {
  return process.env.CV_FFMPEG_PATH ?? 'ffmpeg'
}

// Returns true if the video file has at least one audio stream.
async function hasAudioStream(videoPath: string): Promise<boolean> {
  const ffmpeg = getFfmpegPath()

  return new Promise((resolve) => {
    const child = spawn(ffmpeg, ['-i', videoPath, '-hide_banner'])
    let stderr = ''
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString() })
    child.on('error', () => resolve(false))
    child.on('close', () => resolve(/Stream.*Audio/i.test(stderr)))
  })
}

// Extracts audio from any video buffer and re-encodes as mp3, ensuring
// Whisper receives a consistently supported format regardless of source codec.
async function extractAudioAsMp3(videoPath: string, mp3Path: string): Promise<void> {
  const ffmpeg = getFfmpegPath()

  await new Promise<void>((resolve, reject) => {
    const child = spawn(ffmpeg, [
      '-i', videoPath,
      '-vn',              // drop video stream
      '-acodec', 'libmp3lame',
      '-q:a', '2',        // VBR quality ~190 kbps — good enough for speech
      '-y',
      mp3Path,
    ])

    let stderr = ''
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString() })
    child.on('error', (err) => reject(new Error(`ffmpeg not found: ${err.message}`)))
    child.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`ffmpeg audio extraction exited ${code}: ${stderr.slice(-300)}`))
    })
  })
}

export async function transcribeVideoBuffer(params: {
  buffer: Buffer
  extension: string
}): Promise<TranscriptResult> {
  const { buffer, extension } = params

  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not configured.')
  }

  const id = randomUUID()
  const videoPath = path.join(os.tmpdir(), `${id}${extension}`)
  const mp3Path = path.join(os.tmpdir(), `${id}.mp3`)

  await fsp.writeFile(videoPath, buffer)

  try {
    const audioPresent = await hasAudioStream(videoPath)

    if (!audioPresent) {
      return { text: '', segments: [] }
    }

    await extractAudioAsMp3(videoPath, mp3Path)

    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

    const transcription = await client.audio.transcriptions.create({
      model: 'whisper-1',
      file: fs.createReadStream(mp3Path),
      response_format: 'verbose_json',
      timestamp_granularities: ['segment'],
    })

    const text = transcription.text.trim()

    const segments: TranscriptSegment[] = (transcription.segments ?? []).map((s) => ({
      start: s.start,
      end: s.end,
      text: s.text.trim(),
    }))

    return { text, segments }
  } finally {
    await Promise.all([
      fsp.rm(videoPath, { force: true }),
      fsp.rm(mp3Path, { force: true }),
    ])
  }
}

export function formatTimestampedTranscript(segments: TranscriptSegment[]): string {
  if (segments.length === 0) return ''

  return segments
    .map((s) => {
      const m = Math.floor(s.start / 60)
      const sec = Math.floor(s.start % 60)
      const timestamp = `${m}:${sec.toString().padStart(2, '0')}`
      return `[${timestamp}] ${s.text}`
    })
    .join('\n')
}
