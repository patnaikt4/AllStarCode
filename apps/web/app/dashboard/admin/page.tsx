/**
 * Admin Dashboard.
 * TODO: Protect route: only allow if profiles.role === 'admin'.
 * TODO: Add assign lessons, limit upload length, admin view.
 */
export default function AdminDashboardPage() {
  return (
    <main style={{ padding: "2rem", fontFamily: "sans-serif" }}>
      <h1>Admin Dashboard</h1>
      <p>Placeholder. TODO: Assign lessons, limit upload length, admin view.</p>
      <p><a href="/dashboard">Back to Dashboard</a></p>
    </main>
  );
}
