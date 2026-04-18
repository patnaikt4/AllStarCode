-- files table: tracks every pdf uploaded by a user
CREATE TABLE files (
  file_id       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  storage_path  text        NOT NULL,
  original_name text        NOT NULL,
  content_type  text        NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE files ENABLE ROW LEVEL SECURITY;

-- users can only insert/select their own rows
CREATE POLICY "users insert own files"
  ON files FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "users select own files"
  ON files FOR SELECT
  USING (auth.uid() = user_id);

-- storage policies: users can only upload/read inside their own folder (documents/{user_id}/...)
CREATE POLICY "users upload own files"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'documents' AND
    (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "users read own files"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'documents' AND
    (storage.foldername(name))[1] = auth.uid()::text
  );
