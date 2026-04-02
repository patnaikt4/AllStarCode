-- One-time reconcile: legacy `feedback` (bigint feedback_id, column `feedback`, FK to profiles)
-- -> app schema (uuid id, user_id -> auth.users, lesson_plan_id, feedback_text, original_filename, status).
-- Safe to re-run: if `feedback_id` column is already gone, this is a no-op.

DO $$
DECLARE
  is_legacy boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'feedback'
      AND column_name = 'feedback_id'
  )
  INTO is_legacy;

  IF NOT is_legacy THEN
    RAISE NOTICE '0007: feedback already matches app schema; skipping rebuild';
    RETURN;
  END IF;

  CREATE TABLE feedback_rebuilt (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    lesson_plan_id text NOT NULL,
    storage_path text NOT NULL UNIQUE,
    feedback_text text NOT NULL,
    original_filename text NOT NULL,
    status text NOT NULL DEFAULT 'ready',
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT feedback_rebuilt_status_check CHECK (status IN ('pending', 'ready', 'failed'))
  );

  INSERT INTO feedback_rebuilt (
    user_id,
    lesson_plan_id,
    storage_path,
    feedback_text,
    original_filename,
    status,
    created_at
  )
  SELECT
    f.instructor_id,
    COALESCE(
      (regexp_match(COALESCE(f.storage_path, ''), '^[0-9a-fA-F-]{36}/([^/]+)/'))[1],
      'legacy'
    ),
    CASE
      WHEN f.storage_path IS NOT NULL AND length(trim(f.storage_path)) > 0 THEN trim(f.storage_path)
      ELSE f.instructor_id::text || '/legacy/feedback-' || f.feedback_id::text || '.pdf'
    END,
    COALESCE(f.feedback, ''),
    'legacy-feedback.pdf',
    'ready',
    f.created_at
  FROM feedback f
  WHERE f.instructor_id IS NOT NULL;

  DROP TABLE feedback CASCADE;

  ALTER TABLE feedback_rebuilt RENAME TO feedback;

  ALTER TABLE feedback ENABLE ROW LEVEL SECURITY;

  CREATE INDEX IF NOT EXISTS feedback_user_id_created_idx
    ON feedback (user_id, created_at DESC);

  DROP POLICY IF EXISTS "Users can read own or admin feedback" ON feedback;
  CREATE POLICY "Users can read own or admin feedback"
    ON feedback FOR SELECT
    USING (
      auth.uid() = user_id
      OR EXISTS (
        SELECT 1
        FROM profiles
        WHERE profiles.id = auth.uid()
          AND profiles.role = 'admin'
      )
    );

  DROP POLICY IF EXISTS "Users can insert own or admin feedback" ON feedback;
  CREATE POLICY "Users can insert own or admin feedback"
    ON feedback FOR INSERT
    WITH CHECK (
      auth.uid() = user_id
      OR EXISTS (
        SELECT 1
        FROM profiles
        WHERE profiles.id = auth.uid()
          AND profiles.role = 'admin'
      )
    );

  RAISE NOTICE '0007: feedback rebuilt to app schema';
END $$;
