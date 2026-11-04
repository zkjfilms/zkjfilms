"use client";

import { useEffect, useState } from "react";
import { formatPrice, formatSessionLength } from "@/lib/format";

export type AppointmentType = {
  id: string;
  name: string;
  duration_minutes: number;
  buffer_before_minutes: number;
  buffer_after_minutes: number;
  price_cents: number;
  requires_payment: boolean;
  color: string;
};

type Status = "loading" | "ready" | "error";

// The URL query a preselect was last handled for. Module-level so it
// survives the picker remounting on "Change" (same query -> no reselect),
// while arriving via a different link (a new query, even through client-side
// navigation) preselects again.
let preselectHandledFor: string | null = null;

// Two ways to arrive with a session already chosen:
// - /book?id=<type id>: a private type's link (copied from the admin). The
//   list endpoint only returns that private type when asked for its id.
// - /book?type=<service slug>: a service page's "Book This Session" (e.g.
//   "headshots"). The slug is matched against each type's name, slugified
//   ("Professional Headshots" -> "professional-headshots"), so admin renames
//   that keep the key word still match. Only an unambiguous single match
//   preselects; otherwise the full list shows as usual.
function findPreselectedType(types: AppointmentType[]): AppointmentType | null {
  const params = new URLSearchParams(window.location.search);
  const id = params.get("id");
  if (id) return types.find((t) => t.id === id) ?? null;
  const slug = params.get("type")?.toLowerCase();
  if (!slug) return null;
  const matches = types.filter((t) =>
    t.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").includes(slug),
  );
  return matches.length === 1 ? matches[0] : null;
}

export default function AppointmentTypePicker({
  onSelect,
}: {
  onSelect: (appointmentType: AppointmentType) => void;
}) {
  const [status, setStatus] = useState<Status>("loading");
  const [appointmentTypes, setAppointmentTypes] = useState<AppointmentType[]>(
    [],
  );

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setStatus("loading");
      try {
        const id = new URLSearchParams(window.location.search).get("id");
        const response = await fetch(
          id
            ? `/api/availability/appointment-types?id=${encodeURIComponent(id)}`
            : "/api/availability/appointment-types",
        );
        const data: { appointmentTypes?: AppointmentType[] } =
          await response.json();
        if (cancelled) return;
        if (!response.ok || !data.appointmentTypes) {
          setStatus("error");
          return;
        }
        setAppointmentTypes(data.appointmentTypes);
        setStatus("ready");
        // Preselect once per page visit: "Change" remounts this picker, and
        // reselecting here would trap the visitor on the same session. ?id=
        // stays in the URL (rather than being stripped like ?type=) so a
        // private type stays in the list after "Change".
        const alreadyHandled = preselectHandledFor === window.location.search;
        const preselected = alreadyHandled ? null : findPreselectedType(data.appointmentTypes);
        if (preselected) {
          const url = new URL(window.location.href);
          url.searchParams.delete("type");
          window.history.replaceState(null, "", url);
          onSelect(preselected);
        }
        preselectHandledFor = window.location.search;
      } catch {
        if (!cancelled) setStatus("error");
      }
    }

    load();
    return () => {
      cancelled = true;
    };
    // Runs once on mount: onSelect is a fresh closure from the parent each
    // render, and re-running would refetch and re-preselect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (status === "loading") {
    return <p className="text-muted">Loading session types…</p>;
  }

  if (status === "error") {
    return (
      <p className="text-sm text-red-700">
        Couldn&apos;t load session types. Please refresh, or{" "}
        <a
          href="/contact"
          className="text-accent underline-offset-4 hover:underline"
        >
          reach out directly
        </a>
        .
      </p>
    );
  }

  if (appointmentTypes.length === 0) {
    return (
      <p className="text-muted">
        No session types are available right now — check back soon, or{" "}
        <a
          href="/contact"
          className="text-accent underline-offset-4 hover:underline"
        >
          reach out directly
        </a>
        .
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {appointmentTypes.map((appointmentType) => (
        <button
          key={appointmentType.id}
          type="button"
          onClick={() => onSelect(appointmentType)}
          className="flex w-full items-center gap-4 border border-border px-4 py-4 text-left transition-colors hover:border-accent"
        >
          <span className="flex-1">
            <span className="block text-foreground">
              {appointmentType.name}
            </span>
            <span className="mt-1 block text-xs uppercase tracking-[0.15em] text-muted">
              {formatSessionLength(appointmentType.duration_minutes)}
              {appointmentType.requires_payment
                ? ` · ${formatPrice(appointmentType.price_cents)}`
                : ""}
            </span>
          </span>
        </button>
      ))}
    </div>
  );
}
