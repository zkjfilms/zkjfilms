import type { Metadata } from "next";
import Link from "next/link";
import { getSupabaseClient } from "@/lib/supabase";
import { formatDate } from "@/lib/format";
import { formatTemplateType } from "@/lib/contracts";
import EmailAction from "./EmailAction";

// robots noindex is inherited from app/admin/layout.tsx.
export function generateMetadata(): Metadata {
  return { title: "Admin — Dashboard" };
}

type ContractRow = {
  id: string;
  template_type: string;
  client_name: string;
  client_email: string;
  signed: boolean;
  signed_at: string | null;
  appointment_date: string | null;
  email_sent: boolean;
  created_at: string;
};

export default async function AdminDashboardPage() {
  const supabase = getSupabaseClient();
  const { data: contracts, error } = await supabase
    .from("contracts")
    .select(
      "id, template_type, client_name, client_email, signed, signed_at, appointment_date, email_sent, created_at",
    )
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Supabase contracts list failed:", error);
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-16 sm:px-10">
      <div className="mb-10 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="mb-3 text-xs uppercase tracking-[0.3em] text-muted">
            Admin
          </p>
          <h1 className="font-serif text-3xl italic text-foreground sm:text-4xl">
            Dashboard
          </h1>
        </div>
        <Link
          href="/admin/contracts/new"
          className="border border-foreground px-6 py-2 text-xs uppercase tracking-[0.2em] text-foreground transition-colors hover:bg-foreground hover:text-background"
        >
          New contract
        </Link>
      </div>

      {!contracts || contracts.length === 0 ? (
        <p className="text-muted">
          {error ? "Couldn't load contracts." : "No contracts yet."}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-[0.15em] text-muted">
                <th className="py-3 pr-4 font-normal">Client</th>
                <th className="py-3 pr-4 font-normal">Email</th>
                <th className="py-3 pr-4 font-normal">Template</th>
                <th className="py-3 pr-4 font-normal">Session</th>
                <th className="py-3 pr-4 font-normal">Contract</th>
                <th className="py-3 pr-4 font-normal">Email</th>
                <th className="py-3 font-normal">Link</th>
              </tr>
            </thead>
            <tbody>
              {contracts.map((contract: ContractRow) => (
                <tr key={contract.id} className="border-b border-border/60">
                  <td className="py-3 pr-4 text-foreground">
                    {contract.client_name}
                  </td>
                  <td className="py-3 pr-4 text-muted">
                    {contract.client_email}
                  </td>
                  <td className="py-3 pr-4 text-muted">
                    {formatTemplateType(contract.template_type)}
                  </td>
                  <td className="whitespace-nowrap py-3 pr-4 text-muted">
                    {contract.appointment_date
                      ? formatDate(contract.appointment_date)
                      : `— (created ${formatDate(contract.created_at)})`}
                  </td>
                  <td className="py-3 pr-4">
                    {contract.signed ? (
                      <span className="text-accent">
                        Signed
                        {contract.signed_at
                          ? ` ${formatDate(contract.signed_at)}`
                          : ""}
                      </span>
                    ) : (
                      <span className="text-muted">Pending</span>
                    )}
                  </td>
                  <td className="py-3 pr-4">
                    <EmailAction id={contract.id} emailSent={contract.email_sent} />
                  </td>
                  <td className="py-3">
                    <Link
                      href={`/sign/${contract.id}`}
                      target="_blank"
                      className="text-accent underline-offset-4 hover:underline"
                    >
                      View
                    </Link>
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
