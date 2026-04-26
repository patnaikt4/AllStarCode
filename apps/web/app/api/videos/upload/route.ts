import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import ffprobe from 'ffprobe-static'
import { createClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

const ALLOWED_VIDEO_MIME_TYPES = new Set([
  'video/mp4',
  'video/quicktime',
  'video/webm',
])

function inferVideoMimeType(bytes: Uint8Array): string | null {
  // ISO BMFF/QuickTime containers expose an `ftyp` box starting at byte 4.
  if (bytes.length >= 12) {
    const boxType = new TextDecoder().decode(bytes.slice(4, 8))
    if (boxType === 'ftyp') {
      const brand = new TextDecoder().decode(bytes.slice(8, 12))
      if (brand.startsWith('qt')) return 'video/quicktime'
      return 'video/mp4'
    }
  }

  // WebM files are EBML containers and start with 0x1a45dfa3.
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x1a &&
    bytes[1] === 0x45 &&
    bytes[2] === 0xdf &&
    bytes[3] === 0xa3
  ) {
    return 'video/webm'
  }

  return null
}

function parseAdminMaxVideoSeconds() {
  const raw = process.env.ADMIN_MAX_VIDEO_SECONDS?.trim()
  if (!raw) return null

  const parsed = Number.parseInt(raw, 10)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    console.error('invalid ADMIN_MAX_VIDEO_SECONDS:', raw)
    return null
  }

  return parsed
}

async function probeDurationSeconds(file: File, fileId: string, extension: string) {
  const tempPath = path.join(os.tmpdir(), `${fileId}${extension}`)
  const buffer = Buffer.from(await file.arrayBuffer())

  await fs.writeFile(tempPath, buffer)

  try {
    const output = await new Promise<string>((resolve, reject) => {
      const child = spawn(ffprobe.path, [
        '-v',
        'error',
        '-show_entries',
        'format=duration',
        '-of',
        'default=noprint_wrappers=1:nokey=1',
        tempPath,
      ])

      let stdout = ''
      let stderr = ''

      child.stdout.on('data', (chunk) => {
        stdout += chunk.toString()
      })

      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString()
      })

      child.on('error', (error) => {
        reject(error)
      })

      child.on('close', (code) => {
        if (code === 0) {
          resolve(stdout.trim())
          return
        }

        reject(new Error(stderr.trim() || `ffprobe exited with code ${code}`))
      })
    })

    const durationSeconds = Number.parseFloat(output)
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
      throw new Error(`invalid duration output: ${output}`)
    }

    return durationSeconds
  } finally {
    await fs.rm(tempPath, { force: true })
  }
}

export async function POST(request: Request) {
  const supabase = await createClient()

  // only logged-in users can upload
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return new Response('unauthorized', { status: 401 })

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('role, assigned_admin_id, max_video_duration_seconds')
    .eq('id', user.id)
    .maybeSingle()

  if (profileError || !profile) {
    console.error('failed to load uploader profile:', profileError)
    return new Response('failed to load profile', { status: 500 })
  }

  const form = await request.formData()
  const file = form.get('file') as File | null

  // basic validation
  if (!file || file.size === 0) return new Response('file is required', { status: 400 })
  if (!ALLOWED_VIDEO_MIME_TYPES.has(file.type)) {
    return new Response('file must be an mp4, mov, or webm video', { status: 400 })
  }

  // check magic bytes so we're not trusting content-type alone
  const header = new Uint8Array(await file.slice(0, 32).arrayBuffer())
  const inferredMimeType = inferVideoMimeType(header)

  if (!inferredMimeType) {
    return new Response('file is not a valid mp4, mov, or webm video', { status: 400 })
  }

  if (inferredMimeType !== file.type) {
    return new Response('file type does not match file contents', { status: 400 })
  }

  let effectiveLimitSeconds: number | null = null

  if (profile.role === 'instructor') {
    if (
      profile.max_video_duration_seconds !== null &&
      !profile.assigned_admin_id
    ) {
      console.error('instructor cap configured without assigned admin:', user.id)
      return new Response('profile configuration error', { status: 500 })
    }

    effectiveLimitSeconds = profile.max_video_duration_seconds
  } else if (profile.role === 'admin') {
    effectiveLimitSeconds = parseAdminMaxVideoSeconds()
  } else {
    return new Response('forbidden', { status: 403 })
  }

  const fileId = randomUUID()
  const extension =
    inferredMimeType === 'video/mp4'
      ? '.mp4'
      : inferredMimeType === 'video/quicktime'
        ? '.mov'
        : '.webm'

  let durationSeconds: number

  try {
    durationSeconds = await probeDurationSeconds(file, fileId, extension)
  } catch (error) {
    console.error('video duration probe failed:', error)
    return new Response('video inspection failed', { status: 500 })
  }

  if (
    effectiveLimitSeconds !== null &&
    durationSeconds > effectiveLimitSeconds
  ) {
    return new Response(
      `video exceeds max duration of ${effectiveLimitSeconds} seconds`,
      { status: 400 }
    )
  }

  const storagePath = `${user.id}/${fileId}${extension}`

  // upload to storage bucket
  const { error: uploadError } = await supabase.storage
    .from('videos')
    .upload(storagePath, file, { contentType: inferredMimeType })

  if (uploadError) {
    console.error('storage upload failed:', uploadError)
    return new Response('upload failed', { status: 500 })
  }

  return Response.json(
    {
      file_id: fileId,
      duration_seconds: durationSeconds,
    },
    { status: 201 }
  )
}
