"use client";

import { useState, type ChangeEvent, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { AppointmentType } from "@/app/admin/appointment-types/AppointmentTypeList";
import type { DiscountCode, DiscountCodeType } from "@/lib/discountCodes";

type Status = "idle" | "loading" | "error";

// Excludes visually-confusable characters (0/O, 1/I/L) so a code is easy
// to read aloud or hand-write when given directly to a client.
const CODE_CHARSET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 8;

function generateRandomCode(): string {
  const bytes = new Uint8Array(CODE_LENGTH);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => CODE_CHARSET[b % CODE_CHARSET.length]).join("");
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard access can fail (insecure context, denied permission) —
      // silently no-op rather than surface an error for a low-stakes
      // convenience action.
    }
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      disabled={!value}
      className="text-xs text-muted underline-offset-4 transition-colors hover:text-foreground hover:underline disabled:opacity-50"
    >
      {copied ? "Copied!" : "Copy"}
    </button>
  );
}

function toFormState(discountCode: DiscountCode | null) {
  if (!discountCode) {
    return {
      code: "",
      type: "percentage" as DiscountCodeType,
      value: "",
      active: true,
      expiresAt: "",
      maxRedemptions: "",
      appointmentTypeIds: [] as string[],
    };
  }
  return {
    code: discountCode.code,
    type: discountCode.type,
    value:
      discountCode.type === "percentage"
        ? String(discountCode.value)
        : (discountCode.value / 100).toString(),
    active: discountCode.active,
    expiresAt: discountCode.expires_at ? discountCode.expires_at.slice(0, 10) : "",
    maxRedemptions: discountCode.max_redemptions ? String(discountCode.max_redemptions) : "",
    appointmentTypeIds: discountCode.appointment_type_ids ?? [],
  };
}

export default function DiscountCodeForm({
  discountCode = null,
  appointmentTypes,
  onDone,
  onCancel,
}: {
  discountCode?: DiscountCode | null;
  appointmentTypes: AppointmentType[];
  onDone: () => void;
  onCancel: () => void;
}) {
  const router = useRouter();
  const [form, setForm] = useState(() => toFormState(discountCode));
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState("");
  const [oneTimeUse, setOneTimeUse] = useState(false);
  const [createdCode, setCreatedCode] = useState<string | null>(null);

  const isEditing = discountCode !== null;

  function handleChange(
    e: ChangeEvent<HTMLInputElement | HTMLSelectElement>,
  ) {
    const { name, value, type } = e.target;
    const checked = (e.target as HTMLInputElement).checked;
    setForm((prev) => ({
      ...prev,
      [name]: type === "checkbox" ? checked : value,
    }));
  }

  function toggleAppointmentType(id: string) {
    setForm((prev) => ({
      ...prev,
      appointmentTypeIds: prev.appointmentTypeIds.includes(id)
        ? prev.appointmentTypeIds.filter((existing) => existing !== id)
        : [...prev.appointmentTypeIds, id],
    }));
  }

  function handleGenerateCode() {
    setForm((prev) => ({ ...prev, code: generateRandomCode() }));
  }

  function handleOneTimeUseChange(e: ChangeEvent<HTMLInputElement>) {
    const checked = e.target.checked;
    setOneTimeUse(checked);
    if (checked) {
      setForm((prev) => ({ ...prev, maxRedemptions: "1" }));
    }
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setStatus("loading");
    setError("");

    if (!form.code.trim()) {
      setError("Enter a code.");
      setStatus("error");
      return;
    }

    const rawValue = Number(form.value);
    if (!Number.isFinite(rawValue) || rawValue <= 0) {
      setError("Enter a valid value.");
      setStatus("error");
      return;
    }
    if (form.type === "percentage" && rawValue > 100) {
      setError("Percentage must be 100 or less.");
      setStatus("error");
      return;
    }
    const value = form.type === "percentage" ? Math.round(rawValue) : Math.round(rawValue * 100);

    let maxRedemptions: number | null = null;
    if (form.maxRedemptions.trim()) {
      const parsed = Number(form.maxRedemptions);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        setError("Enter a valid usage limit.");
        setStatus("error");
        return;
      }
      maxRedemptions = parsed;
    }

    const body = {
      code: form.code.trim().toUpperCase(),
      type: form.type,
      value,
      active: form.active,
      expiresAt: form.expiresAt ? new Date(`${form.expiresAt}T23:59:59`).toISOString() : null,
      maxRedemptions,
      appointmentTypeIds: form.appointmentTypeIds.length > 0 ? form.appointmentTypeIds : null,
    };

    try {
      const response = await fetch(
        isEditing ? `/api/admin/discount-codes/${discountCode.id}` : "/api/admin/discount-codes",
        {
          method: isEditing ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );

      const data: { error?: string; discountCode?: { code: string } } = await response.json();

      if (!response.ok) {
        setError(data.error ?? "Something went wrong. Please try again.");
        setStatus("error");
        return;
      }

      setStatus("idle");
      router.refresh();
      if (isEditing) {
        onDone();
      } else {
        setCreatedCode(data.discountCode?.code ?? body.code);
      }
    } catch {
      setError("Something went wrong. Please try again.");
      setStatus("error");
    }
  }

  if (createdCode) {
    return (
      <div className="max-w-lg space-y-4 border border-border p-6">
        <p className="text-xs uppercase tracking-[0.15em] text-muted">Code created</p>
        <div className="flex items-center gap-4">
          <p className="font-mono text-2xl text-foreground">{createdCode}</p>
          <CopyButton value={createdCode} />
        </div>
        <button
          type="button"
          onClick={onDone}
          className="border border-foreground px-6 py-2 text-xs uppercase tracking-[0.2em] text-foreground transition-colors hover:bg-foreground hover:text-background"
        >
          Done
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="max-w-lg space-y-4 border border-border p-6">
      <div>
        <div className="flex items-center justify-between">
          <label htmlFor="code" className="block text-xs uppercase tracking-[0.15em] text-muted">
            Code
          </label>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleGenerateCode}
              className="text-xs text-muted underline-offset-4 transition-colors hover:text-foreground hover:underline"
            >
              Generate
            </button>
            <CopyButton value={form.code} />
          </div>
        </div>
        <input
          id="code"
          name="code"
          type="text"
          required
          value={form.code}
          onChange={handleChange}
          className="mt-2 w-full border-b border-border bg-transparent py-2 text-foreground outline-none focus:border-accent"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="type" className="block text-xs uppercase tracking-[0.15em] text-muted">
            Type
          </label>
          <select
            id="type"
            name="type"
            value={form.type}
            onChange={handleChange}
            className="mt-2 w-full border-b border-border bg-transparent py-2 text-foreground outline-none focus:border-accent"
          >
            <option value="percentage">Percentage off</option>
            <option value="fixed_amount">Amount off ($)</option>
          </select>
        </div>
        <div>
          <label htmlFor="value" className="block text-xs uppercase tracking-[0.15em] text-muted">
            {form.type === "percentage" ? "Percent (1-100)" : "Amount ($)"}
          </label>
          <input
            id="value"
            name="value"
            type="number"
            min="0"
            step={form.type === "percentage" ? "1" : "0.01"}
            required
            value={form.value}
            onChange={handleChange}
            className="mt-2 w-full border-b border-border bg-transparent py-2 text-foreground outline-none focus:border-accent"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="expiresAt" className="block text-xs uppercase tracking-[0.15em] text-muted">
            Expires (optional)
          </label>
          <input
            id="expiresAt"
            name="expiresAt"
            type="date"
            value={form.expiresAt}
            onChange={handleChange}
            className="mt-2 w-full border-b border-border bg-transparent py-2 text-foreground outline-none focus:border-accent"
          />
        </div>
        <div>
          <label htmlFor="maxRedemptions" className="block text-xs uppercase tracking-[0.15em] text-muted">
            Usage limit (optional)
          </label>
          <input
            id="maxRedemptions"
            name="maxRedemptions"
            type="number"
            min="1"
            step="1"
            value={form.maxRedemptions}
            onChange={handleChange}
            className="mt-2 w-full border-b border-border bg-transparent py-2 text-foreground outline-none focus:border-accent"
          />
          <label className="mt-2 flex items-center gap-2 text-xs text-muted">
            <input
              type="checkbox"
              checked={oneTimeUse}
              onChange={handleOneTimeUseChange}
              className="h-3.5 w-3.5 border-border accent-accent"
            />
            One-time use
          </label>
        </div>
      </div>

      <div>
        <p className="mb-2 block text-xs uppercase tracking-[0.15em] text-muted">
          Applies to (none checked = all types)
        </p>
        <div className="space-y-2">
          {appointmentTypes.map((appointmentType) => (
            <label key={appointmentType.id} className="flex items-center gap-2 text-sm text-foreground">
              <input
                type="checkbox"
                checked={form.appointmentTypeIds.includes(appointmentType.id)}
                onChange={() => toggleAppointmentType(appointmentType.id)}
                className="h-4 w-4 border-border accent-accent"
              />
              {appointmentType.name}
            </label>
          ))}
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm text-foreground">
        <input
          type="checkbox"
          name="active"
          checked={form.active}
          onChange={handleChange}
          className="h-4 w-4 border-border accent-accent"
        />
        Active
      </label>

      {error && <p className="text-xs text-red-700">{error}</p>}

      <div className="flex items-center gap-4">
        <button
          type="submit"
          disabled={status === "loading"}
          className="border border-foreground px-6 py-2 text-xs uppercase tracking-[0.2em] text-foreground transition-colors hover:bg-foreground hover:text-background disabled:cursor-not-allowed disabled:opacity-50"
        >
          {status === "loading" ? "Saving…" : isEditing ? "Save changes" : "Create code"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={status === "loading"}
          className="text-xs uppercase tracking-[0.2em] text-muted transition-colors hover:text-foreground disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
