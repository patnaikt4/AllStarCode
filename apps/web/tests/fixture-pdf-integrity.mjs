/**
 * Sanity-check the QA fixture PDF (no Supabase required).
 * For full verification: follow docs/feedback-api.md "QA with the fixture PDF"
 * and compare download size/hash to this file.
 */
import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const __dirname = dirname(fileURLToPath(import.meta.url))

test('minimal.pdf exists and looks like a PDF', () => {
  const buf = readFileSync(join(__dirname, 'fixtures', 'minimal.pdf'))
  assert.ok(buf.length >= 8, 'fixture should not be empty')
  assert.equal(
    buf.subarray(0, 5).toString('latin1'),
    '%PDF-',
    'magic bytes should be %PDF-'
  )
})
