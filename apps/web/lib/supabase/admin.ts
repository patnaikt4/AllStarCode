import { createClient } from "@/lib/supabase/server";

type RequireAdminResult =
  | {
      ok: true;
      supabase: Awaited<ReturnType<typeof createClient>>;
      user: {
        id: string;
      };
    }
  | {
      ok: false;
      status: 401 | 403;
      error: string;
    };

export async function requireAdmin(): Promise<RequireAdminResult> {
  const supabase = await createClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return {
      ok: false,
      status: 401,
      error: "Unauthorized",
    };
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, role")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError || !profile || profile.role !== "admin") {
    return {
      ok: false,
      status: 403,
      error: "Forbidden",
    };
  }

  return {
    ok: true,
    supabase,
    user: {
      id: user.id,
    },
  };
}