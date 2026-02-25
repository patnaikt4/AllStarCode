/**
 * Sign up page (Email + Password).
 * TODO: Wire form to Supabase Auth signUp.
 * TODO: On success, redirect to /dashboard (or email confirmation flow).
 * TODO: Insert row into profiles with default role or prompt; show error on failure.
 */
export default function SignupPage() {
  return (
    <main style={{ padding: "2rem", fontFamily: "sans-serif", maxWidth: "24rem" }}>
      <h1>Sign up</h1>
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
        <button type="submit" disabled>Create account</button>
      </form>
      <p style={{ marginTop: "1rem" }}>
        <a href="/login">Already have an account? Log in</a>
      </p>
    </main>
  );
}
