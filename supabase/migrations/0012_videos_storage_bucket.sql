-- Private bucket for instructor-owned video uploads.
INSERT INTO storage.buckets (id, name, public)
VALUES ('videos', 'videos', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Users read own video files" ON storage.objects;
CREATE POLICY "Users read own video files"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'videos'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

DROP POLICY IF EXISTS "Users upload own video files" ON storage.objects;
CREATE POLICY "Users upload own video files"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'videos'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

DROP POLICY IF EXISTS "Admins read assigned instructor videos" ON storage.objects;
CREATE POLICY "Admins read assigned instructor videos"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'videos'
    AND (storage.foldername(name))[1] IN (
      SELECT id::text FROM profiles WHERE assigned_admin_id = auth.uid()
    )
  );
