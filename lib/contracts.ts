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
