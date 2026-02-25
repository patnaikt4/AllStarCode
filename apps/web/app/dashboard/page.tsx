/**
 * Dashboard: post-login landing.
 * TODO: Server-side: get session via Supabase server client; if no session, redirect to /login.
 * TODO: Fetch profiles.role for current user; conditionally render link to Instructor or Admin dashboard.
 */
export default async function DashboardPage() {
  // TODO: const supabase = createClient(); const { data: { user } } = await supabase.auth.getUser();
  // TODO: if (!user) redirect('/login');
  // TODO: const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single();
  const role: "instructor" | "admin" | null = null; // placeholder until auth implemented

  return (
    <main style={{ padding: "2rem", fontFamily: "sans-serif" }}>
      <h1>Dashboard</h1>
      <p>Welcome. Your role: {role ?? "— (not loaded)"}.</p>
      <nav>
        {/* TODO: Render based on profiles.role */}
        <ul style={{ listStyle: "none", padding: 0 }}>
          <li><a href="/dashboard/instructor">Instructor Dashboard</a></li>
          <li><a href="/dashboard/admin">Admin Dashboard</a></li>
        </ul>
      </nav>
      <p><a href="/login">Log out</a> (TODO: wire to signOut)</p>
    </main>
  );
}
