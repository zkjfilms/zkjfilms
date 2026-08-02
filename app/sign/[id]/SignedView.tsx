// Plain presentational component, no hooks — shared between the Server
// Component (page.tsx, for a fresh page load after signing) and
// SignatureForm.tsx (for the immediate post-submit transition), so both
// paths render identically.

export default function SignedView({
  contractText,
  clientName,
  signerName,
  signedAt,
}: {
  contractText: string;
  clientName: string;
  signerName: string;
  signedAt: string;
}) {
  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-16 sm:px-10">
      <div className="mb-8 border border-accent/40 bg-surface p-5">
        <p className="text-xs uppercase tracking-[0.15em] text-muted">
          Signed
        </p>
        <p className="mt-2 text-sm text-foreground">
          Signed by <strong>{signerName}</strong> on{" "}
          {new Date(signedAt).toLocaleString("en-US", {
            dateStyle: "long",
            timeStyle: "short",
          })}
        </p>
        <p className="mt-1 text-xs text-muted">Contract for {clientName}</p>
      </div>

      <div className="whitespace-pre-wrap border border-border p-6 text-sm leading-relaxed text-foreground">
        {contractText}
      </div>
    </div>
  );
}
