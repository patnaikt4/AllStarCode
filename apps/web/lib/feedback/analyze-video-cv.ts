import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export type CvBlendshape = { name: string; mean: number }

export type CvAggregates = {
  face_visibility_ratio: number
  pose_visibility_ratio: number
  blendshape_means: Record<string, number>
  top_blendshapes: CvBlendshape[]
  sample_count: number
  face_sample_count: number
}

export type CvAnalysisResult = {
  aggregates: CvAggregates
  meta: {
    backend: string
    effective_duration_s: number
    sample_count: number
    setup_error: string | null
  }
}

function getCvScriptPath(): string {
  if (process.env.CV_RESEARCH_SCRIPT_PATH) {
    return process.env.CV_RESEARCH_SCRIPT_PATH
  }
  // process.cwd() is apps/web during dev; CvResearch is two directories up
  return path.resolve(process.cwd(), '../../CvResearch/main.py')
}

function getPythonExecutable(): string {
  return process.env.CV_PYTHON_EXECUTABLE ?? 'python'
}

export async function analyzeVideoCV(
  videoBuffer: Buffer,
  extension: string
): Promise<CvAnalysisResult | null> {
  const tmpFile = path.join(os.tmpdir(), `asc-cv-${randomUUID()}${extension}`)

  try {
    await fs.writeFile(tmpFile, videoBuffer)

    const scriptPath = getCvScriptPath()
    const python = getPythonExecutable()
    // Run from the CvResearch dir so models/ and .mplconfig/ land there, not apps/web/
    const cwd = path.dirname(scriptPath)

    const { stdout } = await execFileAsync(python, [scriptPath, tmpFile], {
      timeout: 120_000,
      cwd,
    })

    const result = JSON.parse(stdout) as CvAnalysisResult
    return result
  } catch (error) {
    console.warn(
      'CV analysis failed (non-fatal):',
      error instanceof Error ? error.message : String(error)
    )
    return null
  } finally {
    await fs.unlink(tmpFile).catch(() => {})
  }
}

export function formatCvMetrics(result: CvAnalysisResult): string {
  const { aggregates, meta } = result
  const durationMin = (meta.effective_duration_s / 60).toFixed(1)

  const lines: string[] = [
    `Computer vision analysis (first ${durationMin} min, ${meta.sample_count} frames sampled):`,
    `- Instructor face visible: ${Math.round(aggregates.face_visibility_ratio * 100)}% of frames`,
    `- Instructor body visible: ${Math.round(aggregates.pose_visibility_ratio * 100)}% of frames`,
  ]

  if (aggregates.top_blendshapes.length > 0) {
    const expressions = aggregates.top_blendshapes
      .map((b) => `${b.name} (avg ${b.mean.toFixed(3)})`)
      .join(', ')
    lines.push(`- Dominant facial expressions: ${expressions}`)
  }

  return lines.join('\n')
}
