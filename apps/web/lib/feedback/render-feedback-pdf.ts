import PDFDocument from 'pdfkit'

function splitIntoParagraphs(feedback: string) {
  return feedback
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
}

export async function renderFeedbackPdf(params: {
  title: string
  instructorId: string
  lessonPlanId: string
  feedback: string
}) {
  const { title, instructorId, lessonPlanId, feedback } = params

  return await new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({
      margin: 56,
      size: 'LETTER',
      info: {
        Title: title,
        Author: 'AllStarCode',
        Subject: `Feedback for lesson plan ${lessonPlanId}`,
      },
    })

    const chunks: Buffer[] = []

    doc.on('data', (chunk: Buffer) => {
      chunks.push(chunk)
    })

    doc.on('end', () => {
      resolve(Buffer.concat(chunks))
    })

    doc.on('error', reject)

    doc.fontSize(20).text(title)
    doc.moveDown(0.5)
    doc
      .fontSize(10)
      .fillColor('#666666')
      .text(`Instructor ID: ${instructorId}`)
      .text(`Lesson Plan ID: ${lessonPlanId}`)
      .text(`Generated: ${new Date().toISOString()}`)

    doc.moveDown()
    doc.fillColor('#111111')

    for (const paragraph of splitIntoParagraphs(feedback)) {
      doc.fontSize(12).text(paragraph, {
        lineGap: 4,
      })
      doc.moveDown()
    }

    doc.end()
  })
}
