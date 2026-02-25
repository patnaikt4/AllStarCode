/**
 * Login page (Email + Password).
 * TODO: Wire form to Supabase Auth signInWithPassword.
 * TODO: On success, redirect to /dashboard.
 * TODO: Show error message on failure.
 */
export default function LoginPage() {
  return (
    <main style={{ padding: "2rem", fontFamily: "sans-serif", maxWidth: "24rem" }}>
      <h1>Log in</h1>
      <form>
        {/* TODO: Controlled inputs for email and password */}
        <div style={{ marginBottom: "1rem" }}>
          <label htmlFor="email">Email</label>
          <input id="email" name="email" type="email" placeholder="you@example.com" style={{ display: "block", width: "100%", padding: "0.5rem" }} readOnly aria-label="Email" />
        </div>
        <div style={{ marginBottom: "1rem" }}>
          <label htmlFor="password">Password</label>
          <input id="password" name="password" type="password" placeholder="••••••••" style={{ display: "block", width: "100%", padding: "0.5rem" }} readOnly aria-label="Password" />
        </div>
        <button type="submit" disabled>Sign in</button>
      </form>
      <p style={{ marginTop: "1rem" }}>
        <a href="/signup">Create an account</a>
      </p>
    </main>
  );
}
