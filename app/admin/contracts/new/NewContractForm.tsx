"use client";

import { useState, type ChangeEvent, type FormEvent } from "react";
import { SESSION_TYPES } from "@/lib/leads";
import { formatTemplateType } from "@/lib/contracts";

type Status = "idle" | "loading" | "error" | "created";

type Contract = {
  id: string;
  client_name: string;
  contract_text: string;
};

const EMPTY_FORM = {
  templateType: "",
  clientName: "",
  clientEmail: "",
  sessionType: "",
  sessionDate: "",
};

export default function NewContractForm({
  templateTypes,
}: {
  templateTypes: string[];
}) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState("");
  const [created, setCreated] = useState<Contract | null>(null);
  const [copied, setCopied] = useState(false);

  function handleChange(
    e: ChangeEvent<HTMLInputElement | HTMLSelectElement>,
  ) {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setStatus("loading");
    setError("");

    try {
      const response = await fetch("/api/admin/contracts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });

      const data: { error?: string; contract?: Contract } =
        await response.json();

      if (!response.ok || !data.contract) {
        setError(data.error ?? "Something went wrong. Please try again.");
        setStatus("error");
        return;
      }

      setCreated(data.contract);
      setStatus("created");
    } catch {
      setError("Something went wrong. Please try again.");
      setStatus("error");
    }
  }

  if (created) {
    const signingUrl = `${window.location.origin}/sign/${created.id}`;

    return (
      <div className="border border-border p-6">
        <h2 className="font-serif text-xl italic text-foreground">
          Contract created
        </h2>
        <p className="mt-2 text-sm text-muted">
          Share this link with {created.client_name} to sign:
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <a
            href={`/sign/${created.id}`}
            target="_blank"
            className="break-all border-b border-border text-sm text-accent hover:border-accent"
          >
            {signingUrl}
          </a>
          <button
            type="button"
            onClick={() => {
              navigator.clipboard.writeText(signingUrl);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            }}
            className="border border-foreground px-4 py-1.5 text-xs uppercase tracking-[0.2em] text-foreground transition-colors hover:bg-foreground hover:text-background"
          >
            {copied ? "Copied" : "Copy link"}
          </button>
        </div>

        <details className="mt-6">
          <summary className="cursor-pointer text-xs uppercase tracking-[0.15em] text-muted">
            Preview generated text
          </summary>
          <div className="mt-3 whitespace-pre-wrap border border-border p-4 text-sm text-muted">
            {created.contract_text}
          </div>
        </details>

        <button
          type="button"
          onClick={() => {
            setForm(EMPTY_FORM);
            setCreated(null);
            setStatus("idle");
          }}
          className="mt-6 text-xs uppercase tracking-[0.15em] text-muted underline-offset-4 transition-colors hover:text-foreground hover:underline"
        >
          Create another
        </button>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="max-w-lg space-y-4 border border-border p-6"
    >
      <div>
        <label
          htmlFor="templateType"
          className="block text-xs uppercase tracking-[0.15em] text-muted"
        >
          Template
        </label>
        <select
          id="templateType"
          name="templateType"
          value={form.templateType}
          onChange={handleChange}
          required
          className="mt-2 w-full border-b border-border bg-transparent py-2 text-foreground outline-none focus:border-accent"
        >
          <option value="" disabled>
            Select one
          </option>
          {templateTypes.map((type) => (
            <option key={type} value={type}>
              {formatTemplateType(type)}
            </option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label
            htmlFor="clientName"
            className="block text-xs uppercase tracking-[0.15em] text-muted"
          >
            Client name
          </label>
          <input
            id="clientName"
            name="clientName"
            value={form.clientName}
            onChange={handleChange}
            required
            className="mt-2 w-full border-b border-border bg-transparent py-2 text-foreground outline-none focus:border-accent"
          />
        </div>
        <div>
          <label
            htmlFor="clientEmail"
            className="block text-xs uppercase tracking-[0.15em] text-muted"
          >
            Client email
          </label>
          <input
            id="clientEmail"
            name="clientEmail"
            type="email"
            value={form.clientEmail}
            onChange={handleChange}
            required
            className="mt-2 w-full border-b border-border bg-transparent py-2 text-foreground outline-none focus:border-accent"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label
            htmlFor="sessionType"
            className="block text-xs uppercase tracking-[0.15em] text-muted"
          >
            Session type
          </label>
          <select
            id="sessionType"
            name="sessionType"
            value={form.sessionType}
            onChange={handleChange}
            className="mt-2 w-full border-b border-border bg-transparent py-2 text-foreground outline-none focus:border-accent"
          >
            <option value="">—</option>
            {SESSION_TYPES.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label
            htmlFor="sessionDate"
            className="block text-xs uppercase tracking-[0.15em] text-muted"
          >
            Session date
          </label>
          <input
            id="sessionDate"
            name="sessionDate"
            type="date"
            value={form.sessionDate}
            onChange={handleChange}
            className="mt-2 w-full border-b border-border bg-transparent py-2 text-foreground outline-none focus:border-accent"
          />
        </div>
      </div>

      {error && <p className="text-xs text-red-700">{error}</p>}

      <button
        type="submit"
        disabled={status === "loading"}
        className="border border-foreground px-6 py-2 text-xs uppercase tracking-[0.2em] text-foreground transition-colors hover:bg-foreground hover:text-background disabled:cursor-not-allowed disabled:opacity-50"
      >
        {status === "loading" ? "Creating…" : "Create contract"}
      </button>
    </form>
  );
}
