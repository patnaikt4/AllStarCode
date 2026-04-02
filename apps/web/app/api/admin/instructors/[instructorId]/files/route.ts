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
  const auth = await requireAdmin();

  if (!auth.ok) {
    return NextResponse.json(
      { error: auth.error },
      { status: auth.status }
    );
  }

  const { instructorId } = await context.params;
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

  const { data: fileRows, error: filesError } = await supabase
    .from("files")
    .select("file_id, original_name, storage_path, created_at")
    .eq("user_id", instructorId)
    .order("created_at", { ascending: false });

  if (filesError) {
    return NextResponse.json(
      { error: "Failed to fetch files" },
      { status: 500 }
    );
  }

  const files =
    fileRows?.map((row) => ({
      id: row.file_id,
      name: row.original_name,
      url: row.storage_path,
      created_at: row.created_at,
    })) ?? [];

  return NextResponse.json(files);
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

  // RLS already enforces assignment, but we check explicitly for a clean 404
  const { data: instructor } = await supabase
    .from('profiles')
    .select('id')
    .eq('id', instructorId)
    .eq('assigned_admin_id', user.id)
    .single()

  if (!instructor) return new Response('instructor not found', { status: 404 })

  const { data, error } = await supabase
    .from('files')
    .select('file_id, original_name, content_type, created_at')
    .eq('user_id', instructorId)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('failed to fetch instructor files:', error)
    return new Response('database error', { status: 500 })
  }

  return Response.json(data)
}
