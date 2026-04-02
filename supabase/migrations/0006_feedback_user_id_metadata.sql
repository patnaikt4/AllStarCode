-- Align feedback with dashboard API: user_id, display metadata, status.
-- Renames instructor_id -> user_id (matches app queries and spec).

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'feedback' AND column_name = 'instructor_id'
  ) THEN
    ALTER TABLE feedback RENAME COLUMN instructor_id TO user_id;
  END IF;
END $$;

ALTER TABLE feedback
  ADD COLUMN IF NOT EXISTS original_filename text NOT NULL DEFAULT 'feedback.pdf';

ALTER TABLE feedback
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'ready';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    WHERE t.relname = 'feedback' AND c.conname = 'feedback_status_check'
  ) THEN
    ALTER TABLE feedback ADD CONSTRAINT feedback_status_check
      CHECK (status IN ('pending', 'ready', 'failed'));
  END IF;
END $$;

ALTER TABLE feedback ALTER COLUMN original_filename DROP DEFAULT;

-- RLS policies referenced instructor_id — recreate with user_id
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
