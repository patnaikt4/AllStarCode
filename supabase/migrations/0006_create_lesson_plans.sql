-- Create lesson_plans table
-- Stores uploaded lesson plan PDFs and their current processing status.
-- The storage_path column points to the file in the 'lesson-plans' Supabase Storage bucket.

CREATE TABLE lesson_plans (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  instructor_id uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  file_name     text        NOT NULL,
  storage_path  text        NOT NULL,
  status        text        NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending', 'processing', 'ready', 'failed')),
  error_message text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE lesson_plans ENABLE ROW LEVEL SECURITY;

-- Instructors may read, insert, and update their own lesson plans
CREATE POLICY "Instructors can read own lesson plans"
  ON lesson_plans FOR SELECT
  USING (auth.uid() = instructor_id);

CREATE POLICY "Instructors can insert own lesson plans"
  ON lesson_plans FOR INSERT
  WITH CHECK (auth.uid() = instructor_id);

CREATE POLICY "Instructors can update own lesson plans"
  ON lesson_plans FOR UPDATE
  USING (auth.uid() = instructor_id);
