# Supabase: align database with this repo

Follow in order. Use the **All Star Code** project in the Supabase dashboard.

## 1. Backup (production)

- Dashboard → **Database** → **Backups** (or export critical tables via SQL).

## 2. Install CLI and link

```powershell
npm install -g supabase
supabase login
cd C:\AllStarCode\AllStarCode
```

If `supabase\config.toml` is missing:

```powershell
supabase init
```

Link the hosted project (ref is the subdomain of `NEXT_PUBLIC_SUPABASE_URL`):

```powershell
supabase link --project-ref YOUR_PROJECT_REF
```

## 3. Push migrations

```powershell
supabase db push
```

This applies, in filename order:

| File | Purpose |
|------|--------|
| `0001_create_curriculum_chunks.sql` | pgvector + `curriculum_chunks` + `match_curriculum_chunks` |
| `0002_create_profiles.sql` | `profiles` |
| `0003_profiles_trigger.sql` | signup trigger |
| `0004_create_feedback.sql` | `feedback` (uuid id) + bucket policies — **skipped if objects exist** |
| `0004_create_files.sql` | `files` |
| `0005_admin_instructor_assignment.sql` | admin ↔ instructor |
| `0006_feedback_user_id_metadata.sql` | rename `instructor_id`→`user_id`, add columns — **only if 0004 shape** |
| `0007_rebuild_feedback_legacy_to_app_schema.sql` | **replaces legacy bigint `feedback` table** with app schema |

**If `db push` errors** on `0004` because `feedback` already exists as the **old** table: run **`0007` only** in the SQL Editor first (paste file contents), then run `supabase db push` again, or use `supabase migration repair` per [Supabase docs](https://supabase.com/docs/guides/cli/managing-environments) after aligning with your team.

**If your DB was created only by hand** and `CREATE TABLE` steps conflict: apply **`0007`** in the SQL Editor (it detects legacy `feedback_id` and rebuilds), then mark migrations as applied or fix forward with your DBA.

## 4. Verify in SQL Editor

```sql
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'feedback'
ORDER BY ordinal_position;
```

Expect: `id` (uuid), `user_id`, `lesson_plan_id`, `storage_path`, `feedback_text`, `original_filename`, `status`, `created_at`.

## 5. App

```powershell
cd apps\web
npm install
npm run dev
```

Ensure `apps/web/.env.local` has `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and `OPENAI_API_KEY` where needed.

## 6. Legacy PDF paths

Rows migrated by `0007` keep old `storage_path` when set. If a path was synthetic (`.../legacy/feedback-<id>.pdf`), upload a real PDF to Storage or regenerate via **POST `/api/feedback/generate`**.
