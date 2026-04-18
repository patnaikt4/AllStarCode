-- Update handle_new_user trigger to support admin-invited instructors.
-- When an admin invites an instructor via inviteUserByEmail, the invite metadata
-- includes { role: 'instructor', invited_by: '<adminId>' }.
-- This trigger reads that metadata to set role and assigned_admin_id automatically.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, role, email, assigned_admin_id)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'role', 'instructor'),
    NEW.email,
    CASE
      WHEN NEW.raw_user_meta_data->>'invited_by' IS NOT NULL
      THEN (NEW.raw_user_meta_data->>'invited_by')::uuid
      ELSE NULL
    END
  )
  ON CONFLICT (id) DO UPDATE
    SET
      role           = COALESCE(EXCLUDED.role, profiles.role),
      email          = COALESCE(EXCLUDED.email, profiles.email),
      assigned_admin_id = COALESCE(EXCLUDED.assigned_admin_id, profiles.assigned_admin_id);

  RETURN NEW;
END;
$$;
