// Shared between /admin/templates, /admin/contracts/new, and
// /api/admin/contracts, so the placeholder token set stays consistent
// between where templates are written and where they're filled in.

export type TemplateValues = {
  clientName: string;
  clientEmail: string;
  sessionType: string;
  sessionDate: string;
};

export function fillTemplate(content: string, values: TemplateValues): string {
  const today = new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return content
    .replaceAll("{{client_name}}", values.clientName)
    .replaceAll("{{client_email}}", values.clientEmail)
    .replaceAll("{{session_type}}", values.sessionType)
    .replaceAll("{{session_date}}", values.sessionDate)
    .replaceAll("{{today}}", today);
}

// template_type is free text (not a fixed enum — new types can be added
// directly in the templates table), so this just prettifies whatever
// string is there rather than looking up a hardcoded label.
export function formatTemplateType(type: string): string {
  return type
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

// Best-effort client IP for the signature record — Vercel's edge sets
// x-forwarded-for on every request that reaches this function; the first
// entry in the (possibly comma-separated) chain is the original client.
// Not spoof-proof against a client setting this header directly, but
// that's true of x-forwarded-for in general without a trusted-proxy
// allowlist, and it's the standard best-effort approach for this kind of
// signature audit trail.
export function getClientIp(request: Request): string | null {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    const first = forwardedFor.split(",")[0]?.trim();
    if (first) return first;
  }
  return request.headers.get("x-real-ip");
}
