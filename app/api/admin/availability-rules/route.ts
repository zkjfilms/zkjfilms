import { cookies } from "next/headers";
import { ADMIN_ACCESS_COOKIE, isValidAccessToken } from "@/lib/adminAccess";
import { getSupabaseClient } from "@/lib/supabase";

async function requireAdmin(): Promise<boolean> {
  const cookieStore = await cookies();
  return isValidAccessToken(cookieStore.get(ADMIN_ACCESS_COOKIE)?.value);
}

export async function GET() {
  if (!(await requireAdmin())) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("availability_rules")
    .select("day_of_week, start_time, end_time")
    .order("day_of_week", { ascending: true });

  if (error) {
    console.error("availability_rules list failed:", error);
    return Response.json({ error: "Something went wrong." }, { status: 500 });
  }
  return Response.json({ rules: data });
}

type RuleInput = { dayOfWeek: number; startTime: string; endTime: string };

function parseRules(body: unknown): RuleInput[] | null {
  if (!Array.isArray(body)) return null;
  const rules: RuleInput[] = [];
  for (const item of body) {
    if (
      typeof item !== "object" ||
      item === null ||
      typeof (item as Record<string, unknown>).dayOfWeek !== "number" ||
      typeof (item as Record<string, unknown>).startTime !== "string" ||
      typeof (item as Record<string, unknown>).endTime !== "string"
    ) {
      return null;
    }
    const r = item as unknown as RuleInput;
    if (r.dayOfWeek < 0 || r.dayOfWeek > 6) return null;
    if (r.endTime <= r.startTime) return null;
    rules.push(r);
  }
  return rules;
}

// Replaces the whole weekly template — the "I have regular hours every
// week" editor always submits all enabled days at once, so a delete-all
// + insert-all is simpler and less error-prone than diffing.
export async function PUT(request: Request) {
  if (!(await requireAdmin())) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }
  const rules = parseRules(await request.json().catch(() => null));
  if (!rules) {
    return Response.json({ error: "Invalid rules payload." }, { status: 400 });
  }

  const supabase = getSupabaseClient();
  const { error: deleteError } = await supabase
    .from("availability_rules")
    .delete()
    .gte("day_of_week", 0);
  if (deleteError) {
    console.error("availability_rules delete failed:", deleteError);
    return Response.json({ error: "Something went wrong." }, { status: 500 });
  }

  if (rules.length > 0) {
    const { error: insertError } = await supabase.from("availability_rules").insert(
      rules.map((r) => ({
        day_of_week: r.dayOfWeek,
        start_time: r.startTime,
        end_time: r.endTime,
      })),
    );
    if (insertError) {
      console.error("availability_rules insert failed:", insertError);
      return Response.json({ error: "Something went wrong." }, { status: 500 });
    }
  }

  return Response.json({ ok: true });
}
