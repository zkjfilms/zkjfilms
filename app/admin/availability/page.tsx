import type { Metadata } from "next";
import { getSupabaseClient } from "@/lib/supabase";
import { formatTimeRange } from "@/lib/format";
import AddSlotForm from "./AddSlotForm";
import SlotActions from "./SlotActions";

// robots noindex is inherited from app/admin/layout.tsx.
export function generateMetadata(): Metadata {
  return { title: "Admin — Availability" };
}

type SlotRow = {
  id: string;
  start_time: string;
  end_time: string;
  session_type: string;
  status: "open" | "booked";
  client_name: string | null;
  client_email: string | null;
};

export default async function AdminAvailabilityPage() {
  const supabase = getSupabaseClient();
  const { data: slots, error } = await supabase
    .from("booking_slots")
    .select(
      "id, start_time, end_time, session_type, status, client_name, client_email",
    )
    .order("start_time", { ascending: true });

  if (error) {
    console.error("Supabase booking_slots list failed:", error);
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-16 sm:px-10">
      <div className="mb-10">
        <p className="mb-3 text-xs uppercase tracking-[0.3em] text-muted">
          Admin
        </p>
        <h1 className="font-serif text-3xl italic text-foreground sm:text-4xl">
          Availability
        </h1>
      </div>

      <AddSlotForm />

      {!slots || slots.length === 0 ? (
        <p className="mt-10 text-muted">
          {error ? "Couldn't load slots." : "No slots yet."}
        </p>
      ) : (
        <div className="mt-10 overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-[0.15em] text-muted">
                <th className="py-3 pr-4 font-normal">When</th>
                <th className="py-3 pr-4 font-normal">Session</th>
                <th className="py-3 pr-4 font-normal">Status</th>
                <th className="py-3 pr-4 font-normal">Client</th>
                <th className="py-3 font-normal">Actions</th>
              </tr>
            </thead>
            <tbody>
              {slots.map((slot: SlotRow) => (
                <tr key={slot.id} className="border-b border-border/60">
                  <td className="whitespace-nowrap py-3 pr-4 text-foreground">
                    {formatTimeRange(slot.start_time, slot.end_time)}
                  </td>
                  <td className="py-3 pr-4 text-muted">
                    {slot.session_type}
                  </td>
                  <td className="py-3 pr-4">
                    {slot.status === "booked" ? (
                      <span className="text-accent">Booked</span>
                    ) : (
                      <span className="text-muted">Open</span>
                    )}
                  </td>
                  <td className="py-3 pr-4 text-muted">
                    {slot.client_name
                      ? `${slot.client_name} (${slot.client_email})`
                      : "—"}
                  </td>
                  <td className="py-3">
                    <SlotActions id={slot.id} status={slot.status} />
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
