/**
 * Home / landing page.
 * TODO: Redirect to /dashboard if authenticated, else to /login.
 */
export default function HomePage() {
  return (
    <main style={{ padding: "2rem", fontFamily: "sans-serif" }}>
      <h1>AI Lesson Video Feedback Tool</h1>
      <p>All Star Code – instructor feedback and lesson planning.</p>
      <p>
        <a href="/login">Log in</a> · <a href="/signup">Sign up</a>
      </p>
    </main>
  );
}
