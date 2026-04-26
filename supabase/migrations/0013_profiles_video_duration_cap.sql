-- Optional per-instructor upload cap for video uploads, in seconds.
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS max_video_duration_seconds integer;

ALTER TABLE profiles
  DROP CONSTRAINT IF EXISTS profiles_max_video_duration_seconds_check;

ALTER TABLE profiles
  ADD CONSTRAINT profiles_max_video_duration_seconds_check
  CHECK (
    max_video_duration_seconds IS NULL
    OR max_video_duration_seconds > 0
  );

COMMENT ON COLUMN public.profiles.max_video_duration_seconds IS
  'Optional per-instructor upload cap in seconds.';

-- Regular authenticated users should not be able to set their own upload cap directly.
REVOKE UPDATE (max_video_duration_seconds) ON public.profiles FROM anon, authenticated;

-- Service role can update the cap after server-side admin authorization.
GRANT UPDATE (max_video_duration_seconds) ON public.profiles TO service_role;
