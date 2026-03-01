# AllStarCode

A learning platform for coding education. You'll learn everything you need to get accounts working locally.

---

## What you need before you start

- [Node.js](https://nodejs.org) version 18 or higher
- Access to the Supabase API keys
- This repository cloned to your computer

---

## Step 1 — Get Supabase API Keys

1. In your Supabase dashboard go to **Project Settings → API**.
2. Copy the **Project URL** and the **anon / public** key.
3. Inside `apps/web`, create `.env.local`.
4. Paste your values in:

```
NEXT_PUBLIC_SUPABASE_URL=paste_your_project_url_here
NEXT_PUBLIC_SUPABASE_ANON_KEY=paste_your_anon_key_here
```

---

## Step 2 — Install dependencies and run the app

Open a terminal, navigate to the web folder, and run:

```
cd apps/web
npm install
npm run dev
```

Open your browser to http://localhost:3000. You will be redirected to the login page.

---

## Creating Test Users

1. Go to http://localhost:3000/signup. 
2. Enter an email and password, then pick a role (Instructor or Admin) from the dropdown.
3. Click **Sign Up** — you will receive an email from Supabase to confirm your address.

Repeat for as many test users as you need (Note: There is a rate limit for Supabase free tier).

---

## Changing a User's Role

If you want to change an existing user's role:

1. In your Supabase dashboard click **Table Editor** in the left sidebar.
2. Open the **profiles** table.
3. Find the row for the user you want to change (the `id` column matches their user ID).
4. Click the pencil icon on that row and change the `role` value to either `admin` or `instructor`.
5. Click **Save**.

---

## Pages in the app

| URL | Who sees it |
|---|---|
| /login | Everyone (not logged in) |
| /signup | Everyone (not logged in) |
| /dashboard | Logged-in users — immediately redirects based on role |
| /admin | Admin users only |
| /instructor | Instructor users only |

Trying to visit /admin, /instructor, or /dashboard without being logged in will redirect you to /login automatically.