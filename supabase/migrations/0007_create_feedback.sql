-- Create feedback table
-- Stores AI-generated feedback PDFs, keyed to the lesson plan and instructor they were generated for.
-- The storage_path column points to the PDF in the 'feedback' Supabase Storage bucket.
-- status lifecycle: processing → ready (success) | failed (error)

CREATE TABLE feedback (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  instructor_id  uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  lesson_plan_id uuid        NOT NULL REFERENCES lesson_plans(id) ON DELETE CASCADE,
  storage_path   text,
  status         text        NOT NULL DEFAULT 'processing'
                             CHECK (status IN ('processing', 'ready', 'failed')),
  error_message  text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE feedback ENABLE ROW LEVEL SECURITY;

-- Instructors may read and insert their own feedback rows.
-- Updates (status transitions) are performed server-side via the service role key.
CREATE POLICY "Instructors can read own feedback"
  ON feedback FOR SELECT
  USING (auth.uid() = instructor_id);

CREATE POLICY "Instructors can insert own feedback"
  ON feedback FOR INSERT
  WITH CHECK (auth.uid() = instructor_id);
