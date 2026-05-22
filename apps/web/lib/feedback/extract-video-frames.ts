import { execFile, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

import ffprobeStatic from 'ffprobe-static'

const execFileAsync = promisify(execFile)

const MAX_FRAMES = 12
const MIN_INTERVAL_SECONDS = 5
const MAX_INTERVAL_SECONDS = 30
// 960px wide gives enough resolution to read code on screen without excessive token cost
const FRAME_WIDTH = 960

export type VideoFrame = {
  timestampSeconds: number
  base64: string
}

function getFfmpegPath(): string {
  return process.env.CV_FFMPEG_PATH ?? 'ffmpeg'
}

async function getVideoDurationSeconds(videoPath: string): Promise<number | null> {
  try {
    const { stdout } = await execFileAsync(ffprobeStatic.path, [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      videoPath,
    ])

    const duration = parseFloat(stdout.trim())
    return Number.isFinite(duration) && duration > 0 ? duration : null
  } catch {
    return null
  }
}

function calculateInterval(durationSeconds: number): number {
  const ideal = durationSeconds / MAX_FRAMES
  return Math.max(MIN_INTERVAL_SECONDS, Math.min(MAX_INTERVAL_SECONDS, ideal))
}

function formatTimestamp(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

export async function extractVideoFrames(
  videoBuffer: Buffer,
  extension: string
): Promise<VideoFrame[]> {
  const id = randomUUID()
  const tmpDir = path.join(os.tmpdir(), `asc-frames-${id}`)
  const inputPath = path.join(os.tmpdir(), `asc-frame-in-${id}${extension}`)

  try {
    await fs.writeFile(inputPath, videoBuffer)
    await fs.mkdir(tmpDir, { recursive: true })

    const durationSeconds = await getVideoDurationSeconds(inputPath)

    if (!durationSeconds) {
      console.warn('extractVideoFrames: could not determine video duration')
      return []
    }

    const interval = calculateInterval(durationSeconds)
    const ffmpeg = getFfmpegPath()

    // Extract frames at calculated interval, scaled to FRAME_WIDTH wide
    await new Promise<void>((resolve, reject) => {
      const child = spawn(ffmpeg, [
        '-i', inputPath,
        '-vf', `fps=1/${interval},scale=${FRAME_WIDTH}:-2`,
        '-q:v', '3',
        '-f', 'image2',
        path.join(tmpDir, 'frame_%04d.jpg'),
        '-y',
      ])

      let stderr = ''
      child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString() })
      child.on('error', (err) => reject(new Error(`ffmpeg not found: ${err.message}`)))
      child.on('close', (code) => {
        if (code === 0) resolve()
        else reject(new Error(`ffmpeg frame extraction exited ${code}: ${stderr.slice(-300)}`))
      })
    })

    const frameFiles = (await fs.readdir(tmpDir))
      .filter((f) => f.endsWith('.jpg'))
      .sort()

    const frames: VideoFrame[] = []

    for (let i = 0; i < frameFiles.length; i++) {
      const filePath = path.join(tmpDir, frameFiles[i])
      const buffer = await fs.readFile(filePath)
      const timestampSeconds = Math.round(i * interval)

      frames.push({
        timestampSeconds,
        base64: buffer.toString('base64'),
      })
    }

    return frames
  } catch (error) {
    console.warn(
      'extractVideoFrames failed (non-fatal):',
      error instanceof Error ? error.message : String(error)
    )
    return []
  } finally {
    await Promise.all([
      fs.rm(inputPath, { force: true }),
      fs.rm(tmpDir, { recursive: true, force: true }),
    ])
  }
}

export { formatTimestamp }
