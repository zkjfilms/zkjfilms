import type { Metadata } from "next";
import { getSupabaseClient } from "@/lib/supabase";
import { formatDate } from "@/lib/format";
import type { LeadStatus } from "@/lib/leads";
import LeadActions from "./LeadActions";
import AddLeadForm from "./AddLeadForm";

// robots noindex is inherited from app/admin/layout.tsx.
export function generateMetadata(): Metadata {
  return { title: "Admin — Leads" };
}

type LeadRow = {
  id: string;
  name: string;
  email: string;
  session_type: string;
  message: string;
  status: LeadStatus;
  source: string;
  notes: string | null;
  created_at: string;
};

export default async function AdminLeadsPage() {
  const supabase = getSupabaseClient();
  const { data: leads, error } = await supabase
    .from("leads")
    .select(
      "id, name, email, session_type, message, status, source, notes, created_at",
    )
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Supabase leads list failed:", error);
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-16 sm:px-10">
      <div className="mb-10">
        <p className="mb-3 text-xs uppercase tracking-[0.3em] text-muted">
          Admin
        </p>
        <h1 className="font-serif text-3xl italic text-foreground sm:text-4xl">
          Leads
        </h1>
      </div>

      <AddLeadForm />

      {!leads || leads.length === 0 ? (
        <p className="text-muted">
          {error ? "Couldn't load leads." : "No leads yet."}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[880px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-[0.15em] text-muted">
                <th className="py-3 pr-4 font-normal">Name</th>
                <th className="py-3 pr-4 font-normal">Email</th>
                <th className="py-3 pr-4 font-normal">Session</th>
                <th className="py-3 pr-4 font-normal">Message</th>
                <th className="py-3 pr-4 font-normal">Received</th>
                <th className="py-3 pr-4 font-normal">Source</th>
                <th className="py-3 font-normal">Status / Notes</th>
              </tr>
            </thead>
            <tbody>
              {leads.map((lead: LeadRow) => (
                <tr key={lead.id} className="border-b border-border/60 align-top">
                  <td className="py-3 pr-4 text-foreground">{lead.name}</td>
                  <td className="py-3 pr-4 text-muted">
                    <a
                      href={`mailto:${lead.email}`}
                      className="hover:text-foreground hover:underline"
                    >
                      {lead.email}
                    </a>
                  </td>
                  <td className="py-3 pr-4 text-muted">{lead.session_type}</td>
                  <td className="max-w-xs py-3 pr-4 text-muted">
                    {lead.message}
                  </td>
                  <td className="whitespace-nowrap py-3 pr-4 text-muted">
                    {formatDate(lead.created_at)}
                  </td>
                  <td className="py-3 pr-4 text-muted">
                    {lead.source === "manual" ? "Manual" : "Contact form"}
                  </td>
                  <td className="py-3">
                    <LeadActions
                      id={lead.id}
                      status={lead.status}
                      notes={lead.notes}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
