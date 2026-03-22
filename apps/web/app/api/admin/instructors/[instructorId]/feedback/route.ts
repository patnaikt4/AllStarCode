import { requireAdmin } from "@/lib/supabase/admin";
import { NextResponse } from "next/server";

  
export async function GET(
    _request: Request,
    { params }: { params: { instructorId: string } }
  ) {
    const { instructorId } = params;

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
  
    // TODO: The current feedback schema does not include an instructor_id
    // or a feedback text field, so instructor-specific feedback cannot be
    // queried yet. Return an empty array until the schema is updated or
    // the correct table/relationship is confirmed.
    return NextResponse.json([]);
  }