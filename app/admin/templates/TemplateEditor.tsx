"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatTemplateType } from "@/lib/contracts";

type Status = "idle" | "saving" | "saved" | "error";

export default function TemplateEditor({
  templateType,
  initialContent,
}: {
  templateType: string;
  initialContent: string;
}) {
  const router = useRouter();
  const [content, setContent] = useState(initialContent);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState("");

  const dirty = content !== initialContent;

  async function handleSave() {
    setStatus("saving");
    setError("");

    try {
      const response = await fetch(`/api/admin/templates/${templateType}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });

      const data: { error?: string } = await response.json();

      if (!response.ok) {
        setError(data.error ?? "Failed to save.");
        setStatus("error");
        return;
      }

      setStatus("saved");
      router.refresh();
    } catch {
      setError("Failed to save.");
      setStatus("error");
    }
  }

  return (
    <div className="border border-border p-6">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-serif text-xl italic text-foreground">
          {formatTemplateType(templateType)}
        </h2>
        <span className="text-xs uppercase tracking-[0.15em] text-muted">
          {templateType}
        </span>
      </div>

      <textarea
        value={content}
        onChange={(e) => {
          setContent(e.target.value);
          setStatus("idle");
        }}
        rows={14}
        className="w-full resize-y border border-border bg-transparent p-4 font-mono text-sm text-foreground outline-none focus:border-accent"
      />

      <p className="mt-2 text-xs text-muted">
        Available tokens: {"{{client_name}}"}, {"{{client_email}}"},{" "}
        {"{{session_type}}"}, {"{{session_date}}"}, {"{{today}}"}
      </p>

      {error && <p className="mt-2 text-xs text-red-700">{error}</p>}

      <div className="mt-4 flex items-center gap-4">
        <button
          type="button"
          onClick={handleSave}
          disabled={!dirty || status === "saving"}
          className="border border-foreground px-6 py-2 text-xs uppercase tracking-[0.2em] text-foreground transition-colors hover:bg-foreground hover:text-background disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-foreground"
        >
          {status === "saving" ? "Saving…" : "Save"}
        </button>
        {status === "saved" && !dirty && (
          <span className="text-xs text-muted">Saved.</span>
        )}
      </div>
    </div>
  );
}
