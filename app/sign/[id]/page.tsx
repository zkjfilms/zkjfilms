import type { Metadata } from "next";
import { getSupabaseClient } from "@/lib/supabase";
import SignatureForm from "./SignatureForm";
import SignedView from "./SignedView";

// Signing links are private — never indexed, disallowed in robots.ts too.
export function generateMetadata(): Metadata {
  return {
    title: "Sign Contract",
    robots: {
      index: false,
      follow: false,
    },
  };
}

function ContractNotFound() {
  return (
    <div className="mx-auto flex min-h-[70vh] w-full max-w-md flex-col items-center justify-center px-6 py-24 text-center sm:px-10">
      <p className="mb-3 text-xs uppercase tracking-[0.3em] text-muted">
        Contract
      </p>
      <h1 className="font-serif text-3xl italic text-foreground sm:text-4xl">
        Not found
      </h1>
      <p className="mt-4 text-muted">
        This signing link doesn&rsquo;t match an active contract.
        Double-check the link, or contact the sender.
      </p>
    </div>
  );
}

export default async function SignPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const supabase = getSupabaseClient();
  const { data: contract, error } = await supabase
    .from("contracts")
    .select("id, client_name, contract_text, signed, signed_at, signer_name")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    console.error("Supabase contract lookup failed:", error);
  }

  if (!contract) {
    return <ContractNotFound />;
  }

  if (contract.signed && contract.signer_name && contract.signed_at) {
    return (
      <SignedView
        contractText={contract.contract_text}
        clientName={contract.client_name}
        signerName={contract.signer_name}
        signedAt={contract.signed_at}
      />
    );
  }

  return (
    <SignatureForm
      id={contract.id}
      contractText={contract.contract_text}
      clientName={contract.client_name}
    />
  );
}
