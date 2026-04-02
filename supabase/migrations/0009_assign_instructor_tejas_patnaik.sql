-- Assign instructor f12c93c9-2b18-40dc-ad78-cf14725ded4a to admin tejaspatnaik@college.harvard.edu
-- (profiles.assigned_admin_id → managing admin's auth.users id)
-- No-op if that auth user or instructor profile row is missing.

UPDATE public.profiles AS p
SET assigned_admin_id = a.admin_id
FROM (
  SELECT id AS admin_id
  FROM auth.users
  WHERE lower(email) = lower('tejaspatnaik@college.harvard.edu')
  LIMIT 1
) AS a
WHERE p.id = 'f12c93c9-2b18-40dc-ad78-cf14725ded4a'::uuid
  AND a.admin_id IS NOT NULL;
