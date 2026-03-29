// Server-only — Feedback PDF generation
// Takes the structured feedback text returned by the RAG pipeline and renders it as a PDF buffer.

import PDFDocument from 'pdfkit'

// Brand colours
const BRAND_BLUE = '#0055A5'  // All Star Code primary
const DARK_TEXT  = '#1a1a1a'
const MUTED_TEXT = '#555555'

/**
 * Render feedback text into a formatted PDF buffer.
 *
 * The feedback text is expected to use the structured format produced by the RAG pipeline
 * (## headings, numbered lists). This function parses that lightweight markdown-like
 * structure and renders it as styled PDF content.
 *
 * @param feedbackText  Structured feedback string from the RAG pipeline
 * @param lessonPlanId  Used for the footer/metadata only
 * @returns             PDF file as a Node.js Buffer
 */
export async function generateFeedbackPdf(
  feedbackText: string,
  lessonPlanId: string
): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    // bufferPages: true is required for doc.bufferedPageRange() and doc.switchToPage()
    // used in the footer loop below.
    const doc = new PDFDocument({ margin: 60, size: 'LETTER', bufferPages: true })
    const chunks: Buffer[] = []

    doc.on('data', (chunk: Buffer) => chunks.push(chunk))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)

    // ── Cover header ──────────────────────────────────────────────────────────
    doc
      .fillColor(BRAND_BLUE)
      .fontSize(22)
      .font('Helvetica-Bold')
      .text('All Star Code', { align: 'left' })
      .moveDown(0.2)
      .fontSize(14)
      .font('Helvetica')
      .fillColor(MUTED_TEXT)
      .text('AI-Generated Lesson Plan Feedback', { align: 'left' })
      .moveDown(0.5)

    // Divider
    doc
      .strokeColor(BRAND_BLUE)
      .lineWidth(1.5)
      .moveTo(60, doc.y)
      .lineTo(doc.page.width - 60, doc.y)
      .stroke()
      .moveDown(0.8)

    // Metadata line
    const generatedAt = new Date().toLocaleString('en-US', {
      dateStyle: 'long',
      timeStyle: 'short',
    })
    doc
      .fontSize(9)
      .fillColor(MUTED_TEXT)
      .text(`Generated: ${generatedAt}   |   Lesson Plan ID: ${lessonPlanId}`, { align: 'right' })
      .moveDown(1)

    // ── Body — parse structured feedback text ─────────────────────────────────
    const lines = feedbackText.split('\n')

    for (const rawLine of lines) {
      const line = rawLine.trimEnd()

      if (!line) {
        doc.moveDown(0.4)
        continue
      }

      // H2 heading: ## Heading Text
      if (line.startsWith('## ')) {
        const heading = line.slice(3).trim()
        doc
          .moveDown(0.6)
          .fillColor(BRAND_BLUE)
          .fontSize(13)
          .font('Helvetica-Bold')
          .text(heading)
          .moveDown(0.3)
          .fillColor(DARK_TEXT)
          .fontSize(10)
          .font('Helvetica')
        continue
      }

      // H3 heading: ### Heading Text
      if (line.startsWith('### ')) {
        const heading = line.slice(4).trim()
        doc
          .moveDown(0.4)
          .fillColor(DARK_TEXT)
          .fontSize(11)
          .font('Helvetica-Bold')
          .text(heading)
          .moveDown(0.2)
          .fontSize(10)
          .font('Helvetica')
        continue
      }

      // Bold key–value pairs: **Label:** value
      if (line.startsWith('**') && line.includes(':**')) {
        const boldEnd = line.indexOf(':**')
        const label = line.slice(2, boldEnd)
        const value = line.slice(boldEnd + 3).trim()
        doc
          .fontSize(10)
          .font('Helvetica-Bold')
          .fillColor(DARK_TEXT)
          .text(label + ': ', { continued: true })
          .font('Helvetica')
          .text(value)
        continue
      }

      // Horizontal rule: ---
      if (line === '---') {
        doc
          .moveDown(0.4)
          .strokeColor('#dddddd')
          .lineWidth(0.5)
          .moveTo(60, doc.y)
          .lineTo(doc.page.width - 60, doc.y)
          .stroke()
          .moveDown(0.4)
        continue
      }

      // Numbered list item: "1. text" or "2. text" etc.
      // Render as a single text call to avoid pdfkit continued+indent alignment issues.
      if (/^\d+\.\s/.test(line)) {
        doc
          .fontSize(10)
          .font('Helvetica')
          .fillColor(DARK_TEXT)
          .text(line, { indent: 12 })
        continue
      }

      // Bullet: "- text" or "* text"
      if (/^[-*]\s/.test(line)) {
        const text = line.slice(2).trim()
        doc
          .fontSize(10)
          .font('Helvetica')
          .fillColor(DARK_TEXT)
          .text('•  ' + text, { indent: 20 })
        continue
      }

      // Default paragraph text
      doc
        .fontSize(10)
        .font('Helvetica')
        .fillColor(DARK_TEXT)
        .text(line)
    }

    // ── Footer ─────────────────────────────────────────────────────────────────
    const pageCount = doc.bufferedPageRange().count
    for (let i = 0; i < pageCount; i++) {
      doc.switchToPage(i)
      doc
        .fontSize(8)
        .fillColor(MUTED_TEXT)
        .text(
          `All Star Code — Confidential   |   Page ${i + 1} of ${pageCount}`,
          60,
          doc.page.height - 40,
          { align: 'center', width: doc.page.width - 120 }
        )
    }

    doc.end()
  })
}
