import { getSupabaseClient } from "@/lib/supabase";

// Postgres-backed, not in-memory — a Vercel serverless function's memory
// isn't shared across invocations or regions, so an in-memory counter
// would under-count and fail to actually throttle anything in production.
export async function checkRateLimit(params: {
  ip: string;
  endpoint: string;
  maxHits: number;
  windowMinutes: number;
}): Promise<{ allowed: boolean }> {
  const supabase = getSupabaseClient();
  const windowStart = new Date(Date.now() - params.windowMinutes * 60 * 1000).toISOString();

  const { count, error } = await supabase
    .from("rate_limit_hits")
    .select("id", { count: "exact", head: true })
    .eq("ip", params.ip)
    .eq("endpoint", params.endpoint)
    .gte("created_at", windowStart);

  if (error) {
    console.error("Rate limit check failed, failing open:", error);
    return { allowed: true };
  }

  if ((count ?? 0) >= params.maxHits) {
    return { allowed: false };
  }

  await supabase.from("rate_limit_hits").insert({ ip: params.ip, endpoint: params.endpoint });
  return { allowed: true };
}

export function getClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return "unknown";
}
