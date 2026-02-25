-- Profiles table: links auth.users to app role (instructor | admin).
-- Run after Supabase Auth is enabled (Email + Password).

-- TODO: Create profiles table
-- Fields:
--   id (uuid primary key, references auth.users(id) on delete cascade)
--   role (text not null, check: role in ('instructor', 'admin'))
--   email (text, optional)
--   created_at (timestamptz default now())
--   updated_at (timestamptz default now())

-- TODO: Enable RLS; policy so users can read their own row
-- TODO: Trigger to insert a profile row on auth.users signup (optional)
