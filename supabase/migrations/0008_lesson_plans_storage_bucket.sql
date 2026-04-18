-- Private bucket for lesson plan PDFs consumed by POST /api/feedback/generate
INSERT INTO storage.buckets (id, name, public)
VALUES ('lesson-plans', 'lesson-plans', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Users read own lesson plan files" ON storage.objects;
CREATE POLICY "Users read own lesson plan files"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'lesson-plans'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

DROP POLICY IF EXISTS "Users upload own lesson plan files" ON storage.objects;
CREATE POLICY "Users upload own lesson plan files"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'lesson-plans'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

DROP POLICY IF EXISTS "Users update own lesson plan files" ON storage.objects;
CREATE POLICY "Users update own lesson plan files"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'lesson-plans'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );
