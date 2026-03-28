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