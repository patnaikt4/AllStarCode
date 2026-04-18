console.log("Extract");
import { PDFParse } from 'pdf-parse'

function isPdfBuffer(buffer: Buffer) {
  console.log("My buffer: ");
  console.log(buffer);
  return buffer.length >= 4 && buffer.subarray(0, 4).toString('ascii') === '%PDF'
}

function toErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) {
    return error.message
  }

  return 'Unknown PDF parsing error'
}

export async function extractTextFromPdf(buffer: Buffer): Promise<string> {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new Error('Cannot extract text from an empty PDF buffer.')
  }

  if (!isPdfBuffer(buffer)) {
    throw new Error('Cannot extract text from a non-PDF file.')
  }

  const parser = new PDFParse({ data: new Uint8Array(buffer) })

  try {
    const result = await parser.getText()
    const text = result.text.replace(/\0/g, '').trim()

    if (!text) {
      throw new Error('PDF did not contain any extractable text.')
    }

    return text
  } catch (error) {
    throw new Error(`Failed to extract text from PDF: ${toErrorMessage(error)}`)
  } finally {
    await parser.destroy().catch(() => undefined)
  }
}
