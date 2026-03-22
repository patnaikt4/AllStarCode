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