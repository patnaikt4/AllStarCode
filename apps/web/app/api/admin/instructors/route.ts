import { requireAdmin } from "@/lib/supabase/admin";
import { NextResponse } from "next/server";

export async function GET() {
  const auth = await requireAdmin();

  if (!auth.ok) {
    return NextResponse.json(
      { error: auth.error },
      { status: auth.status }
    );
  }

  const { supabase } = auth;

  const { data: instructors, error } = await supabase
    .from("profiles")
    .select("id")
    .eq("role", "instructor");

  if (error) {
    return NextResponse.json(
      { error: "Failed to fetch instructors" },
      { status: 500 }
    );
  }

  return NextResponse.json(instructors ?? []);
}
import { createClient } from '@/lib/supabase/server'

// returns all instructors assigned to the logged-in admin
export async function GET() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return new Response('unauthorized', { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (profile?.role !== 'admin') return new Response('forbidden', { status: 403 })

  const { data, error } = await supabase
    .from('profiles')
    .select('id, email')
    .eq('assigned_admin_id', user.id)
    .eq('role', 'instructor')

  if (error) {
    console.error('failed to fetch instructors:', error)
    return new Response('database error', { status: 500 })
  }

  return Response.json(data)
}
