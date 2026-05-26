# Auth, Middleware, and Supabase Clients

This document covers the infrastructure that handles session management for every request: the Next.js middleware, the auth callback route, the Supabase client wrappers, and the shared auth helpers used inside feedback routes.

---

## Middleware

**File:** `apps/web/middleware.ts`

Runs on every request that matches the protected-route patterns. Refreshes the Supabase session cookie and redirects unauthenticated users to `/login`.

### What it does

1. Creates a Supabase server client with read/write access to the request's cookies
2. Calls `supabase.auth.getSession()` — reads the JWT from the cookie without a network call (avoids Edge Runtime fetch issues)
3. If no session is found, redirects to `/login`
4. If a session is found, returns the response (with any refreshed cookies attached)

### Why `getSession()` instead of `getUser()`

Middleware uses `getSession()` (cookie-only, no network) rather than `getUser()` (server-validated). The security boundary is that `getUser()` is called in each individual Route Handler when the request actually needs a trusted user identity. The middleware's job is only to gate access at the page level.

### Protected routes

```ts
matcher: [
  '/dashboard/:path*',
  '/admin/:path*',
  '/instructor',
  '/instructor/:path*',
]
```

Any path not in this list (e.g., `/login`, `/api/**`, `/auth/**`) is not intercepted by the middleware.

---

## Auth callback route

**File:** `apps/web/app/auth/callback/route.ts`

Handles the redirect that Supabase sends after email confirmation or OAuth sign-in. Exchanges the one-time `code` query param for a session.

```
GET /auth/callback?code=<code>&next=/dashboard
```

**Steps:**

1. Read `code` and `next` from the query string (`next` defaults to `/dashboard`)
2. Call `supabase.auth.exchangeCodeForSession(code)` to exchange the code for a session cookie
3. On success, redirect to `${origin}${next}`
4. On any failure (missing code, expired code, exchange error), redirect to `/login?error=auth_callback_failed`

This route is the landing point for the invite flow — when an invited instructor clicks the link in their email and sets a password, Supabase redirects here.

---

## Supabase client wrappers

### Server client

**File:** `apps/web/lib/supabase/server.ts`

```ts
createClient(): Promise<SupabaseServerClient>
```

Used in Route Handlers and Server Components. Creates a `@supabase/ssr` server client backed by the Next.js cookie store.

The `setAll` method silently catches errors when called from a Server Component — cookies can only be written in Route Handlers or Server Actions, so the error is expected and safe to ignore. The middleware handles session refresh for Server Components.

### Browser client

**File:** `apps/web/lib/supabase/client.ts`

```ts
createClient(): SupabaseBrowserClient
```

Used in Client Components (`'use client'`). Creates a `@supabase/ssr` browser client with the two public env vars.

### Which to use

| Context | Import |
|---|---|
| Route Handler, Server Component, Middleware | `lib/supabase/server.ts` |
| Client Component (`'use client'`) | `lib/supabase/client.ts` |

Both use the same `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`. The server client is async (`await createClient()`) because it reads from the Next.js async cookie store.

---

## Feedback route auth helpers

**File:** `apps/web/lib/feedback/feedback-route-auth.ts`

Three shared helpers used by `GET /api/feedback/user/:userId` and `GET /api/feedback/:feedbackId` to enforce session and ownership rules.

### `getSessionUser`

```ts
getSessionUser(supabase: SupabaseServer): Promise<SessionResult>
```

Calls `supabase.auth.getUser()` and returns either `{ ok: true, user, supabase }` or `{ ok: false, response: Response(401) }`. All feedback routes call this first before touching any data.

### `requireMatchingUserId`

```ts
requireMatchingUserId(sessionUserId: string, paramUserId: string): Response | null
```

Used by `GET /feedback/user/:userId`. Returns a `403` response if `sessionUserId !== paramUserId`, otherwise `null` (access allowed). Enforces that instructors can only list their own feedback history.

### `assertFeedbackRowAccess`

```ts
assertFeedbackRowAccess(
  supabase: SupabaseServer,
  sessionUserId: string,
  rowUserId: string
): Promise<Response | null>
```

Used by `GET /feedback/:feedbackId`. Allows access if `sessionUserId === rowUserId`. If they differ, queries `profiles.role` for the session user — if `role = 'admin'`, access is still granted. Otherwise returns `404` (not `403`, to avoid leaking that the feedback ID exists). This is a defense-in-depth layer on top of RLS.
