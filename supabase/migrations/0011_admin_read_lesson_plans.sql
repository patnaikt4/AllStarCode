-- Allow admins to read lesson plan PDFs uploaded by their assigned instructors.
CREATE POLICY "Admins read assigned instructor lesson plans"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'lesson-plans'
    AND (storage.foldername(name))[1] IN (
      SELECT id::text FROM profiles WHERE assigned_admin_id = auth.uid()
    )
  );
