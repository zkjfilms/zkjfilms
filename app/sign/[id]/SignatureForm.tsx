"use client";

import { useState, type FormEvent } from "react";
import SignedView from "./SignedView";

type Status = "idle" | "loading";

type SignedResult = { signerName: string; signedAt: string };

export default function SignatureForm({
  id,
  contractText,
  clientName,
}: {
  id: string;
  contractText: string;
  clientName: string;
}) {
  const [signerName, setSignerName] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState("");
  const [signedResult, setSignedResult] = useState<SignedResult | null>(null);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (status === "loading") return;

    setStatus("loading");
    setError("");

    try {
      const response = await fetch(`/api/sign/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ signerName, agreed }),
      });

      const data: {
        error?: string;
        contract?: { signer_name: string; signed_at: string };
      } = await response.json();

      if (!response.ok || !data.contract) {
        setError(data.error ?? "Something went wrong. Please try again.");
        setStatus("idle");
        return;
      }

      setSignedResult({
        signerName: data.contract.signer_name,
        signedAt: data.contract.signed_at,
      });
    } catch {
      setError("Something went wrong. Please try again.");
      setStatus("idle");
    }
  }

  if (signedResult) {
    return (
      <SignedView
        contractText={contractText}
        clientName={clientName}
        signerName={signedResult.signerName}
        signedAt={signedResult.signedAt}
      />
    );
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-16 sm:px-10">
      <div className="mb-8">
        <p className="text-xs uppercase tracking-[0.3em] text-muted">
          Please review
        </p>
        <h1 className="mt-2 font-serif text-3xl italic text-foreground sm:text-4xl">
          Contract for {clientName}
        </h1>
      </div>

      <div className="whitespace-pre-wrap border border-border p-6 text-sm leading-relaxed text-foreground">
        {contractText}
      </div>

      <form onSubmit={handleSubmit} className="mt-10 max-w-md space-y-6">
        <div>
          <label
            htmlFor="signerName"
            className="block text-xs uppercase tracking-[0.15em] text-muted"
          >
            Type your full legal name to sign
          </label>
          <input
            id="signerName"
            value={signerName}
            onChange={(e) => {
              setSignerName(e.target.value);
              setError("");
            }}
            className="mt-2 w-full border-b border-border bg-transparent py-2 text-foreground outline-none focus:border-accent"
          />
        </div>

        <label className="flex items-start gap-3 text-sm text-muted">
          <input
            type="checkbox"
            checked={agreed}
            onChange={(e) => setAgreed(e.target.checked)}
            className="mt-1 h-4 w-4 shrink-0 border-border bg-transparent accent-accent"
          />
          I have read and agree to the terms above.
        </label>

        {error && <p className="text-sm text-red-700">{error}</p>}

        <button
          type="submit"
          disabled={!signerName.trim() || !agreed || status === "loading"}
          className="w-full border border-foreground px-8 py-3 text-xs uppercase tracking-[0.2em] text-foreground transition-colors hover:bg-foreground hover:text-background disabled:cursor-not-allowed disabled:opacity-50"
        >
          {status === "loading" ? "Signing…" : "Sign"}
        </button>
      </form>
    </div>
  );
}
