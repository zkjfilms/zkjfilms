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
  // x-vercel-forwarded-for is set by Vercel's edge network itself and
  // can't be spoofed by the client. x-forwarded-for, by contrast, can
  // arrive from the client with attacker-controlled entries prepended —
  // the trustworthy value is always the *last* entry (the one Vercel's
  // proxy appended), not the first, or a client could rotate through
  // fake IPs to defeat this rate limiter entirely.
  const vercelForwarded = request.headers.get("x-vercel-forwarded-for");
  if (vercelForwarded) return vercelForwarded.split(",")[0].trim();

  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const parts = forwarded.split(",").map((p) => p.trim());
    return parts[parts.length - 1];
  }

  return "unknown";
}
