// Server-only — PDF text extraction
// Contract: buffer in → plain text string out
// Throws typed errors so callers can map them to HTTP status codes and DB status values.
//
// Uses pdf-parse v2 class-based API: new PDFParse({ data }) → .getText()

import { PDFParse } from 'pdf-parse'

// ─── Typed error classes ──────────────────────────────────────────────────────

/** The pdf-parse library threw an unexpected error. */
export class PdfExtractionError extends Error {
  readonly code = 'PDF_EXTRACTION_ERROR' as const
  constructor(message: string, readonly cause?: unknown) {
    super(message)
    this.name = 'PdfExtractionError'
  }
}

/** The PDF was parsed successfully but contained no extractable text
 *  (e.g. a scanned image-only PDF with no embedded text layer). */
export class PdfEmptyError extends Error {
  readonly code = 'PDF_EMPTY' as const
  constructor() {
    super('PDF contained no extractable text — it may be a scanned image or empty document')
    this.name = 'PdfEmptyError'
  }
}

/** pdf-parse rejected the buffer as invalid / corrupt. */
export class PdfCorruptError extends Error {
  readonly code = 'PDF_CORRUPT' as const
  constructor(readonly cause?: unknown) {
    super('PDF appears to be corrupt or is not a valid PDF file')
    this.name = 'PdfCorruptError'
  }
}

export type PdfError = PdfExtractionError | PdfEmptyError | PdfCorruptError

// ─── Extraction function ──────────────────────────────────────────────────────

/**
 * Extract plain text from a PDF buffer.
 *
 * @param buffer  Raw bytes of a PDF file
 * @returns       Extracted text with leading/trailing whitespace trimmed
 * @throws        PdfCorruptError    — unparseable / invalid PDF
 * @throws        PdfEmptyError      — no text could be extracted
 * @throws        PdfExtractionError — any other library-level failure
 */
export async function extractTextFromPdf(buffer: Buffer): Promise<string> {
  let result: { text: string }
  const parser = new PDFParse({ data: buffer })
  try {
    result = await parser.getText()
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (
      msg.includes('Invalid PDF') ||
      msg.includes('corrupt') ||
      msg.includes('Bad') ||
      msg.includes('startxref') ||
      msg.includes('XRef') ||
      msg.includes('not a PDF')
    ) {
      throw new PdfCorruptError(err)
    }
    throw new PdfExtractionError(`Failed to parse PDF: ${msg}`, err)
  } finally {
    // Release the pdfjs worker and any held resources
    await parser.destroy().catch(() => undefined)
  }

  const text = result.text?.trim() ?? ''
  if (!text) {
    throw new PdfEmptyError()
  }

  return text
}
