/**
 * Instructor Dashboard.
 * TODO: Protect route: only allow if profiles.role === 'instructor' (or admin if you allow both).
 * TODO: Add links to upload lesson, view feedback, lesson-plan workspace.
 */
export default function InstructorDashboardPage() {
  return (
    <main style={{ padding: "2rem", fontFamily: "sans-serif" }}>
      <h1>Instructor Dashboard</h1>
      <p>Placeholder. TODO: Upload lesson, view feedback, lesson-plan workspace.</p>
      <p><a href="/dashboard">Back to Dashboard</a></p>
    </main>
  );
}
