import { requireAdmin } from "@/lib/supabase/admin";
import { NextResponse } from "next/server";

type RouteContext = {
  params: Promise<{
    instructorId: string;
  }>;
};

export async function GET(
  _request: Request,
  context: RouteContext
) {
  const { instructorId } = await context.params;

  const auth = await requireAdmin();

  if (!auth.ok) {
    return NextResponse.json(
      { error: auth.error },
      { status: auth.status }
    );
  }

  const { supabase } = auth;

  const { data: instructor, error: instructorError } = await supabase
    .from("profiles")
    .select("id")
    .eq("id", instructorId)
    .eq("role", "instructor")
    .maybeSingle();

  if (instructorError) {
    return NextResponse.json(
      { error: "Failed to validate instructor" },
      { status: 500 }
    );
  }

  if (!instructor) {
    return NextResponse.json(
      { error: "Instructor not found" },
      { status: 404 }
    );
  }

  const { data: feedbackRows, error: feedbackError } = await supabase
    .from("feedback")
    .select("feedback_id, feedback, created_at")
    .eq("instructor_id", instructorId)
    .order("created_at", { ascending: false });

  if (feedbackError) {
    return NextResponse.json(
      { error: "Failed to fetch feedback" },
      { status: 500 }
    );
  }

  const feedback =
    feedbackRows?.map((row) => ({
      id: row.feedback_id,
      feedback: row.feedback,
      created_at: row.created_at,
    })) ?? [];

  return NextResponse.json(feedback);
}
import { createClient } from '@/lib/supabase/server'

function isValidUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v)
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ instructorId: string }> }
) {
  const { instructorId } = await params
  if (!isValidUuid(instructorId)) return new Response('invalid id', { status: 400 })

  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return new Response('unauthorized', { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (profile?.role !== 'admin') return new Response('forbidden', { status: 403 })

  const { data: instructor } = await supabase
    .from('profiles')
    .select('id')
    .eq('id', instructorId)
    .eq('assigned_admin_id', user.id)
    .single()

  if (!instructor) return new Response('instructor not found', { status: 404 })

  // feedback table is owned by another team — gracefully return empty if it doesn't exist yet
  const { data, error } = await supabase
    .from('feedback')
    .select('id, created_at')
    .eq('user_id', instructorId)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('failed to fetch instructor feedback:', error)
    return new Response('database error', { status: 500 })
  }

  return Response.json(data ?? [])
}
