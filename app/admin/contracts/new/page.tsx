import type { Metadata } from "next";
import { getSupabaseClient } from "@/lib/supabase";
import NewContractForm from "./NewContractForm";

// robots noindex is inherited from app/admin/layout.tsx.
export function generateMetadata(): Metadata {
  return { title: "Admin — New Contract" };
}

export default async function NewContractPage() {
  const supabase = getSupabaseClient();
  const { data: templates, error } = await supabase
    .from("templates")
    .select("template_type")
    .order("template_type", { ascending: true });

  if (error) {
    console.error("Supabase templates list failed:", error);
  }

  const templateTypes = (templates ?? []).map(
    (t: { template_type: string }) => t.template_type,
  );

  return (
    <div className="mx-auto w-full max-w-4xl px-6 py-16 sm:px-10">
      <div className="mb-10">
        <p className="mb-3 text-xs uppercase tracking-[0.3em] text-muted">
          Admin
        </p>
        <h1 className="font-serif text-3xl italic text-foreground sm:text-4xl">
          New Contract
        </h1>
      </div>

      {templateTypes.length === 0 ? (
        <p className="text-muted">
          No templates found. Add one in /admin/templates first.
        </p>
      ) : (
        <NewContractForm templateTypes={templateTypes} />
      )}
    </div>
  );
}
