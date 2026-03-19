-- Create profiles table
-- Stores the role for each user (admin or instructor)
-- The id column links directly to the Supabase auth.users table

CREATE TABLE profiles (
  id   uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('admin', 'instructor'))
);

-- Turn on Row Level Security so users can only touch their own row
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- Let a logged-in user read their own profile
CREATE POLICY "Users can read own profile"
  ON profiles FOR SELECT
  USING (auth.uid() = id);

-- Let a logged-in user create their own profile (runs once at signup)
CREATE POLICY "Users can insert own profile"
  ON profiles FOR INSERT
  WITH CHECK (auth.uid() = id);

-- Let a logged-in user update their own profile
CREATE POLICY "Users can update own profile"
  ON profiles FOR UPDATE
  USING (auth.uid() = id);
