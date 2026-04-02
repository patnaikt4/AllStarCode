-- Store generated feedback PDFs and their associated metadata.
CREATE TABLE IF NOT EXISTS feedback (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instructor_id  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  lesson_plan_id text NOT NULL,
  storage_path   text NOT NULL UNIQUE,
  feedback_text  text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE feedback ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read own or admin feedback" ON feedback;
CREATE POLICY "Users can read own or admin feedback"
  ON feedback FOR SELECT
  USING (
    auth.uid() = instructor_id
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
    auth.uid() = instructor_id
    OR EXISTS (
      SELECT 1
      FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role = 'admin'
    )
  );

-- Create the private storage bucket used by the feedback download route.
INSERT INTO storage.buckets (id, name, public)
VALUES ('feedback', 'feedback', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Users can read own or admin feedback files" ON storage.objects;
CREATE POLICY "Users can read own or admin feedback files"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'feedback'
    AND (
      auth.uid()::text = (storage.foldername(name))[1]
      OR EXISTS (
        SELECT 1
        FROM profiles
        WHERE profiles.id = auth.uid()
          AND profiles.role = 'admin'
      )
    )
  );

DROP POLICY IF EXISTS "Users can upload own or admin feedback files" ON storage.objects;
CREATE POLICY "Users can upload own or admin feedback files"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'feedback'
    AND (
      auth.uid()::text = (storage.foldername(name))[1]
      OR EXISTS (
        SELECT 1
        FROM profiles
        WHERE profiles.id = auth.uid()
          AND profiles.role = 'admin'
      )
    )
  );
