-- Status tracking: expand feedback + files status values, add source_type,
-- make feedback columns nullable for in-progress rows, add UPDATE RLS policies.

-- ============================================================
-- 1. FILES: add status column
-- ============================================================
ALTER TABLE files
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'uploaded';

ALTER TABLE files
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    WHERE t.relname = 'files' AND c.conname = 'files_status_check'
  ) THEN
    ALTER TABLE files ADD CONSTRAINT files_status_check
      CHECK (status IN ('uploaded', 'transcribing', 'generating', 'complete', 'failed'));
  END IF;
END $$;

-- Backfill existing file rows to 'complete' (they were already fully processed).
UPDATE files SET status = 'complete' WHERE status = 'uploaded';

-- UPDATE policy so the owner can transition status
DROP POLICY IF EXISTS "users update own files" ON files;
CREATE POLICY "users update own files"
  ON files FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ============================================================
-- 2. FEEDBACK: replace status constraint with five-value set
-- ============================================================
ALTER TABLE feedback DROP CONSTRAINT IF EXISTS feedback_status_check;
ALTER TABLE feedback DROP CONSTRAINT IF EXISTS feedback_rebuilt_status_check;

-- Migrate existing data BEFORE adding the new constraint,
-- otherwise rows with 'ready'/'pending' would violate it.
UPDATE feedback SET status = 'complete' WHERE status = 'ready';
UPDATE feedback SET status = 'generating' WHERE status = 'pending';

ALTER TABLE feedback ADD CONSTRAINT feedback_status_check
  CHECK (status IN ('uploaded', 'transcribing', 'generating', 'complete', 'failed'));

-- ============================================================
-- 3. FEEDBACK: add source_type column
-- ============================================================
ALTER TABLE feedback
  ADD COLUMN IF NOT EXISTS source_type text NOT NULL DEFAULT 'pdf';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    WHERE t.relname = 'feedback' AND c.conname = 'feedback_source_type_check'
  ) THEN
    ALTER TABLE feedback ADD CONSTRAINT feedback_source_type_check
      CHECK (source_type IN ('pdf', 'video'));
  END IF;
END $$;

-- ============================================================
-- 4. FEEDBACK: make storage_path and feedback_text nullable
--    so rows can be inserted before processing completes.
-- ============================================================
ALTER TABLE feedback ALTER COLUMN storage_path DROP NOT NULL;
ALTER TABLE feedback ALTER COLUMN feedback_text DROP NOT NULL;

-- Drop the old UNIQUE on storage_path; replace with a partial unique
-- index that only applies when storage_path is non-null.
ALTER TABLE feedback DROP CONSTRAINT IF EXISTS feedback_storage_path_key;
ALTER TABLE feedback DROP CONSTRAINT IF EXISTS feedback_rebuilt_storage_path_key;
DROP INDEX IF EXISTS feedback_storage_path_unique;
CREATE UNIQUE INDEX feedback_storage_path_unique
  ON feedback (storage_path) WHERE storage_path IS NOT NULL;

-- Ensure completed rows have the required fields populated.
ALTER TABLE feedback DROP CONSTRAINT IF EXISTS feedback_complete_fields_check;
ALTER TABLE feedback ADD CONSTRAINT feedback_complete_fields_check
  CHECK (
    status != 'complete'
    OR (storage_path IS NOT NULL AND feedback_text IS NOT NULL)
  );

-- ============================================================
-- 5. FEEDBACK: add updated_at column
-- ============================================================
ALTER TABLE feedback
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- ============================================================
-- 6. FEEDBACK: UPDATE RLS policies
-- ============================================================
DROP POLICY IF EXISTS "Users can update own feedback" ON feedback;
CREATE POLICY "Users can update own feedback"
  ON feedback FOR UPDATE
  USING (
    auth.uid() = user_id
    OR EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid() AND profiles.role = 'admin'
    )
  )
  WITH CHECK (
    auth.uid() = user_id
    OR EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid() AND profiles.role = 'admin'
    )
  );
