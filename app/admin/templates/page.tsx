import type { Metadata } from "next";
import { getSupabaseClient } from "@/lib/supabase";
import TemplateEditor from "./TemplateEditor";

// robots noindex is inherited from app/admin/layout.tsx.
export function generateMetadata(): Metadata {
  return { title: "Admin — Templates" };
}

type TemplateRow = { template_type: string; content: string };

export default async function AdminTemplatesPage() {
  const supabase = getSupabaseClient();
  const { data: templates, error } = await supabase
    .from("templates")
    .select("template_type, content")
    .order("template_type", { ascending: true });

  if (error) {
    console.error("Supabase templates list failed:", error);
  }

  return (
    <div className="mx-auto w-full max-w-4xl px-6 py-16 sm:px-10">
      <div className="mb-10">
        <p className="mb-3 text-xs uppercase tracking-[0.3em] text-muted">
          Admin
        </p>
        <h1 className="font-serif text-3xl italic text-foreground sm:text-4xl">
          Templates
        </h1>
      </div>

      {!templates || templates.length === 0 ? (
        <p className="text-muted">
          {error ? "Couldn't load templates." : "No templates found."}
        </p>
      ) : (
        <div className="space-y-8">
          {templates.map((template: TemplateRow) => (
            <TemplateEditor
              key={template.template_type}
              templateType={template.template_type}
              initialContent={template.content}
            />
          ))}
        </div>
      )}
    </div>
  );
}
