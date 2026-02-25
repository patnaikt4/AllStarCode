# Setup: Auth and Running Locally

## 1. Enable Supabase Auth (Email + Password)

- In the [Supabase Dashboard](https://supabase.com/dashboard), open your project.
- Go to **Authentication** → **Providers**.
- Enable **Email** and ensure **Confirm email** is configured as needed for your environment (e.g. disable for local testing).

## 2. Create the `profiles` table

- Run the migration `supabase/migrations/0002_create_profiles.sql` (or apply the SQL manually in the SQL Editor).
- Ensure the table has: `id` (uuid, references `auth.users(id)`), `role` (e.g. `instructor` or `admin`), and optional `email`, `created_at`, `updated_at`.
- Enable RLS so users can read their own row.

## 3. Creating test users

1. In Supabase Dashboard, go to **Authentication** → **Users**.
2. Click **Add user** → **Create new user**.
3. Enter an email (e.g. `instructor@test.com`, `admin@test.com`) and a password.
4. Create at least one instructor and one admin user for development.

## 4. Assigning roles manually in Supabase

1. Go to **Table Editor** and open the `profiles` table (or run SQL).
2. For each test user, insert a row (or update if a trigger created one):
   - `id`: copy the user’s UUID from **Authentication** → **Users**.
   - `role`: set to `instructor` or `admin`.
   - `email`: optional, can match the auth user email.
3. Alternatively, run SQL, e.g.:

   ```sql
   insert into profiles (id, role, email)
   values ('<user-uuid-from-auth>', 'instructor', 'instructor@test.com');
   ```

## 5. Running the app locally

1. **Supabase:** Create a project at [supabase.com](https://supabase.com) and note the project URL and anon key.
2. **Env:** In `apps/web`, copy `.env.example` to `.env.local` and set:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
3. **Install and run:**
   - `cd apps/web`
   - `npm install`
   - `npm run dev`
4. Open [http://localhost:3000](http://localhost:3000). Use the test user credentials to log in (once auth is implemented).
