-- add email + assigned_admin_id to profiles
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS email text;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS assigned_admin_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

-- update trigger to capture email at signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, role, email)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'role', 'instructor'),
    NEW.email
  );
  RETURN NEW;
END;
$$;

-- admins can read profiles of instructors assigned to them
CREATE POLICY "admins read assigned instructor profiles"
  ON profiles FOR SELECT
  USING (assigned_admin_id = auth.uid());

-- admins can read files belonging to their assigned instructors
CREATE POLICY "admins read instructor files"
  ON files FOR SELECT
  USING (
    user_id IN (
      SELECT id FROM profiles WHERE assigned_admin_id = auth.uid()
    )
  );

-- admins can download instructor files from storage
CREATE POLICY "admins read instructor storage files"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'documents' AND
    (storage.foldername(name))[1] IN (
      SELECT id::text FROM profiles WHERE assigned_admin_id = auth.uid()
    )
  );
