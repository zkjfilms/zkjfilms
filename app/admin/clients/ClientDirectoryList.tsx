"use client";

import { useState } from "react";
import { formatBusinessDate, formatCents } from "@/lib/format";

export type ClientBooking = {
  typeName: string;
  startTime: string;
  amountPaidCents: number | null;
};

export type ClientBookingRow = {
  email: string;
  name: string;
  phone: string | null;
  bookingCount: number;
  firstBooking: string;
  lastBooking: string;
  totalPaidCents: number;
  bookings: ClientBooking[];
};

function ClientRow({ client }: { client: ClientBookingRow }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <>
      <tr className="border-b border-border/60 align-top">
        <td className="py-3 pr-4 text-foreground">{client.name}</td>
        <td className="py-3 pr-4 text-muted">
          <a href={`mailto:${client.email}`} className="hover:text-foreground hover:underline">
            {client.email}
          </a>
        </td>
        <td className="py-3 pr-4 text-muted">{client.phone ?? "—"}</td>
        <td className="py-3 pr-4 text-muted">{client.bookingCount}</td>
        <td className="whitespace-nowrap py-3 pr-4 text-muted">{formatBusinessDate(client.lastBooking)}</td>
        <td className="py-3 pr-4 text-muted">{formatCents(client.totalPaidCents)}</td>
        <td className="py-3">
          <button
            type="button"
            onClick={() => setExpanded((prev) => !prev)}
            className="text-xs text-muted underline-offset-4 transition-colors hover:text-foreground hover:underline"
          >
            {expanded ? "Hide" : "View bookings"}
          </button>
        </td>
      </tr>
      {expanded && (
        <tr className="border-b border-border/60 bg-border/10">
          <td colSpan={7} className="py-3 pr-4">
            <ul className="space-y-1 text-xs text-muted">
              {client.bookings
                .slice()
                .sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime())
                .map((booking, i) => (
                  <li key={i}>
                    {booking.typeName} · {formatBusinessDate(booking.startTime)}
                    {booking.amountPaidCents ? ` · ${formatCents(booking.amountPaidCents)}` : ""}
                  </li>
                ))}
            </ul>
          </td>
        </tr>
      )}
    </>
  );
}

export default function ClientDirectoryList({ clients }: { clients: ClientBookingRow[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[880px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs uppercase tracking-[0.15em] text-muted">
            <th className="py-3 pr-4 font-normal">Name</th>
            <th className="py-3 pr-4 font-normal">Email</th>
            <th className="py-3 pr-4 font-normal">Phone</th>
            <th className="py-3 pr-4 font-normal"># Bookings</th>
            <th className="py-3 pr-4 font-normal">Last Booking</th>
            <th className="py-3 pr-4 font-normal">Total Paid</th>
            <th className="py-3 font-normal"></th>
          </tr>
        </thead>
        <tbody>
          {clients.map((client) => (
            <ClientRow key={client.email} client={client} />
          ))}
        </tbody>
      </table>
    </div>
  );
}
