import fs from 'node:fs'
import { promises as fsp } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

import OpenAI from 'openai'

export async function transcribeVideoBuffer(params: {
  buffer: Buffer
  extension: string
}): Promise<string> {
  const { buffer, extension } = params

  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not configured.')
  }

  const tempPath = path.join(os.tmpdir(), `${randomUUID()}${extension}`)
  await fsp.writeFile(tempPath, buffer)

  try {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

    const transcription = await client.audio.transcriptions.create({
      model: 'gpt-4o-mini-transcribe',
      file: fs.createReadStream(tempPath),
    })

    const text = transcription.text.trim()
    if (!text) {
      throw new Error('Transcription returned empty text.')
    }

    return text
  } finally {
    await fsp.rm(tempPath, { force: true })
  }
}
