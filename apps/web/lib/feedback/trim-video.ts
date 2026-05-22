import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export type TrimRange = {
  startSeconds: number
  endSeconds: number
}

function getFfmpegPath(): string {
  return process.env.CV_FFMPEG_PATH ?? 'ffmpeg'
}

export function validateTrimRange(
  start: unknown,
  end: unknown,
  videoDurationSeconds?: number
): TrimRange | { error: string } {
  if (start === undefined && end === undefined) {
    return { error: 'no range' }
  }
  const s = Number(start)
  const e = Number(end)
  if (!Number.isFinite(s) || s < 0) {
    return { error: 'startSeconds must be a non-negative number' }
  }
  if (!Number.isFinite(e) || e <= 0) {
    return { error: 'endSeconds must be a positive number' }
  }
  if (e <= s) {
    return { error: 'endSeconds must be greater than startSeconds' }
  }
  if (videoDurationSeconds !== undefined && s >= videoDurationSeconds) {
    return {
      error: `startSeconds (${s}) exceeds video duration (${videoDurationSeconds}s)`,
    }
  }
  return { startSeconds: s, endSeconds: e }
}

export async function trimVideoBuffer(
  buffer: Buffer,
  extension: string,
  { startSeconds, endSeconds }: TrimRange
): Promise<Buffer> {
  const ffmpeg = getFfmpegPath()
  const id = randomUUID()
  const inputPath = path.join(os.tmpdir(), `asc-trim-in-${id}${extension}`)
  const outputPath = path.join(os.tmpdir(), `asc-trim-out-${id}${extension}`)

  try {
    await fs.writeFile(inputPath, buffer)

    await new Promise<void>((resolve, reject) => {
      // -ss before -i = fast keyframe seek; -to is the absolute end time
      const child = spawn(ffmpeg, [
        '-ss', String(startSeconds),
        '-to', String(endSeconds),
        '-i', inputPath,
        '-c', 'copy',   // stream-copy — no re-encode, very fast
        '-y',           // overwrite output without asking
        outputPath,
      ])

      let stderr = ''
      child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString() })

      child.on('error', (err) => reject(new Error(`ffmpeg not found: ${err.message}`)))
      child.on('close', (code) => {
        if (code === 0) resolve()
        else reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-300)}`))
      })
    })

    return await fs.readFile(outputPath)
  } finally {
    await Promise.all([
      fs.rm(inputPath, { force: true }),
      fs.rm(outputPath, { force: true }),
    ])
  }
}
